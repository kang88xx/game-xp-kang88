// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * KangLMS — "Last Man Standing" betting game with an ERC-20 token (KANG).
 *
 * Players bet KANG. Each bet splits into burn / treasury / prize pool and
 * extends the round timer. When the timer expires, the LAST bettor wins the
 * prize pool. Design distilled from the audited XphereLMS reference
 * (github.com/hyunilhlee/xphere-lms) with its security-review fixes kept:
 *
 *   • Pull-payment prizes (F3): settle() CREDITS the winner; tokens leave only
 *     via claim(). A failed transfer can never block round progression.
 *   • Sole-bettor refund through the same path (F2): a round that expires with
 *     fewer than 2 unique players refunds its only bettor — never stranded.
 *   • Owner withdrawals can never touch liabilities (F2): outstanding credits
 *     plus the live prize pool are always fully backed.
 *   • Lazy round start: a round's clock starts at its FIRST bet, not before.
 *   • Reentrancy-guarded, effects-before-interaction throughout.
 *
 * Tier model: every `tierStep` bets the bet floor doubles and the round
 * timer halves. Tier t (= betCount / tierStep, capped at MAX_TIER) requires
 * baseBet<<t and, on each bet, RESETS the clock to baseDuration>>t (floored
 * at minDuration). No price oracle — owner-set baseBet/baseDuration instead.
 *
 * Defaults: 1,000 KANG / 24h at tier 0; ×2 bet and ÷2 timer every 10 bets.
 *
 * Self-contained (no imports) so it compiles in Remix or with plain solc.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract KangLMS {
    address public owner;
    IERC20 public immutable token;

    /// Fee destinations — fixed at deploy (anti-rug: not owner-modifiable).
    address public immutable treasury;
    address public immutable burnWallet;

    // ---------- Config (owner-tunable, bounded) ----------

    uint16 public burnBps = 500; // 5%
    uint16 public treasuryBps = 1500; // 15% — prize gets the remainder (80%)
    // Tier model: every `tierStep` bets, the bet floor doubles and the round
    // timer halves. Tier t = betCount / tierStep (capped at MAX_TIER).
    uint256 public baseBet = 1000e18; // tier-0 bet floor: 1,000 KANG
    uint64 public baseDuration = 24 hours; // tier-0 round timer
    uint64 public minDuration = 30; // timer floor (seconds)
    uint32 public tierStep = 10; // bets per tier
    uint8 public constant MAX_TIER = 32; // overflow guard on the 2^t shift
    bool public paused;

    // ---------- State ----------

    struct Round {
        uint256 prizePool;
        uint256 totalBurned;
        uint64 deadline; // 0 = not started (waiting for first bet)
        address lastBettor;
        uint32 betCount;
        uint32 uniquePlayers;
        bool settled;
    }

    uint256 public currentRoundId; // starts at 0; settle() rolls it forward
    uint256 public totalEverBurned;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => bool)) public hasParticipated;

    /// A win/refund credited to an address, kept PER ROUND so prizes never
    /// merge into a single lump: claim them individually (claimRound) or all
    /// at once (claimAll). `amount` is the remaining unclaimed amount.
    struct Win {
        uint256 roundId;
        uint256 amount;
        bool claimed;
        bool isRefund;
    }
    mapping(address => Win[]) private _wins;
    uint256 public totalPendingPrize;

    bool private _locked;

    // ---------- Events ----------

    event BetPlaced(
        uint256 indexed roundId,
        address indexed bettor,
        uint256 amount,
        uint256 prizePool,
        uint64 newDeadline
    );
    event RoundSettled(uint256 indexed id, address indexed winner, uint256 prize);
    event PrizeCredited(
        uint256 indexed roundId,
        address indexed recipient,
        uint256 amount,
        bool isRefund
    );
    event PrizeClaimed(address indexed recipient, uint256 indexed roundId, uint256 amount);
    event ConfigUpdated(string param);
    event PausedSet(bool isPaused);
    event TokenWithdrawn(address indexed to, uint256 amount);
    event OwnerTransferred(address indexed from, address indexed to);

    constructor(address _token, address _treasury, address _burnWallet) {
        require(_token != address(0), "token=0");
        require(_treasury != address(0), "treasury=0");
        require(_burnWallet != address(0), "burn=0");
        owner = msg.sender;
        token = IERC20(_token);
        treasury = _treasury;
        burnWallet = _burnWallet;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "reentrancy");
        _locked = true;
        _;
        _locked = false;
    }

    // ---------- Game ----------

    /**
     * Settle the current round if its deadline has passed: credit the pot
     * (winner, or refund a sole bettor) and roll to the next round. Runs
     * automatically inside bet() and claim(), so the game flows from round
     * to round without anyone sending an explicit settle tx. Makes no
     * external calls — safe inside the nonReentrant entry points.
     */
    function _settleExpired() internal returns (bool) {
        Round storage r = rounds[currentRoundId];
        if (r.deadline == 0 || block.timestamp <= r.deadline || r.settled) {
            return false;
        }

        r.settled = true;
        address recipient = r.lastBettor;
        uint256 amount = r.prizePool;
        r.prizePool = 0;
        bool hasWinner = r.uniquePlayers >= 2 && recipient != address(0);

        if (recipient != address(0) && amount > 0) {
            _wins[recipient].push(Win(currentRoundId, amount, false, !hasWinner));
            totalPendingPrize += amount;
            emit PrizeCredited(currentRoundId, recipient, amount, !hasWinner);
        }
        emit RoundSettled(
            currentRoundId,
            hasWinner ? recipient : address(0),
            hasWinner ? amount : 0
        );

        currentRoundId++;
        return true;
    }

    /**
     * Place a bet in the current round. Caller must have approved this
     * contract for at least `amount`. The first bet of a round starts its
     * clock; each later bet RESETS it to the active tier's timer. If the
     * previous round expired, it is settled HERE — this bet opens the next.
     */
    function bet(uint256 amount) external nonReentrant {
        require(!paused, "paused");
        _settleExpired();
        Round storage r = rounds[currentRoundId];
        require(!r.settled, "settled");
        uint8 tier = tierAt(r.betCount);
        require(amount >= betFloorForTier(tier), "below tier min");

        _safeTransferFrom(msg.sender, address(this), amount, "transfer failed");

        uint256 burnAmount = (amount * burnBps) / 10000;
        uint256 treasuryAmount = (amount * treasuryBps) / 10000;
        uint256 prizeAmount = amount - burnAmount - treasuryAmount;

        r.totalBurned += burnAmount;
        totalEverBurned += burnAmount;
        r.prizePool += prizeAmount;

        if (!hasParticipated[currentRoundId][msg.sender]) {
            hasParticipated[currentRoundId][msg.sender] = true;
            r.uniquePlayers++;
        }
        r.lastBettor = msg.sender;
        r.betCount++;

        // Reset the clock to the active tier's timer (halves every tierStep).
        r.deadline = uint64(block.timestamp) + durationForTier(tier);

        _safeTransfer(burnWallet, burnAmount, "burn failed");
        _safeTransfer(treasury, treasuryAmount, "treasury failed");

        emit BetPlaced(currentRoundId, msg.sender, amount, r.prizePool, r.deadline);
    }

    /**
     * Manually settle the current round after its deadline — anyone may
     * call. Usually unnecessary: bet() and claim() settle automatically.
     */
    function settle(uint256 roundId) external nonReentrant {
        require(roundId == currentRoundId, "not current round");
        require(_settleExpired(), "not expired");
    }

    /**
     * Claim ONE winning round by its id. Settles the current round first, so a
     * just-won pot is claimable in the same tx (its record is created here,
     * then paid). Not gated by `paused` — a winner can always claim.
     * Balance-capped: a shortfall stays claimable later instead of reverting.
     */
    function claimRound(uint256 roundId) external nonReentrant {
        _settleExpired();
        Win[] storage list = _wins[msg.sender];
        uint256 available = token.balanceOf(address(this));
        require(available > 0, "no contract balance");
        for (uint256 i = 0; i < list.length; i++) {
            Win storage w = list[i];
            if (w.roundId == roundId && !w.claimed && w.amount > 0) {
                uint256 pay = w.amount > available ? available : w.amount;
                w.amount -= pay;
                if (w.amount == 0) w.claimed = true;
                totalPendingPrize -= pay;
                _safeTransfer(msg.sender, pay, "transfer failed");
                emit PrizeClaimed(msg.sender, roundId, pay);
                return;
            }
        }
        revert("nothing to claim");
    }

    /**
     * Claim EVERY unclaimed win/refund in one tx (a single transfer). Settles
     * first so a just-won pot is included. Balance-capped per round: any
     * shortfall stays claimable later.
     */
    function claimAll() external nonReentrant {
        _settleExpired();
        Win[] storage list = _wins[msg.sender];
        uint256 available = token.balanceOf(address(this));
        require(available > 0, "no contract balance");
        uint256 totalPaid;
        for (uint256 i = 0; i < list.length; i++) {
            if (available == 0) break;
            Win storage w = list[i];
            if (w.claimed || w.amount == 0) continue;
            uint256 pay = w.amount > available ? available : w.amount;
            w.amount -= pay;
            if (w.amount == 0) w.claimed = true;
            available -= pay;
            totalPaid += pay;
            emit PrizeClaimed(msg.sender, w.roundId, pay);
        }
        require(totalPaid > 0, "nothing to claim");
        totalPendingPrize -= totalPaid;
        _safeTransfer(msg.sender, totalPaid, "transfer failed");
    }

    // ---------- Prize views ----------

    /// Total still unclaimed across all of `who`'s rounds.
    function pendingPrize(address who) external view returns (uint256 total) {
        Win[] storage list = _wins[who];
        for (uint256 i = 0; i < list.length; i++) {
            if (!list[i].claimed) total += list[i].amount;
        }
    }

    /// Number of win records (claimed or not) held for `who`.
    function winCount(address who) external view returns (uint256) {
        return _wins[who].length;
    }

    /// All of `who`'s win records — filter client-side for unclaimed (amount > 0).
    function winsOf(address who) external view returns (Win[] memory) {
        return _wins[who];
    }

    // ---------- Owner ----------

    /// Fee split in bps; prize gets the remainder. Bounded like the reference
    /// so the owner can never starve the prize pool.
    function setFeeSplit(uint16 _burnBps, uint16 _treasuryBps) external onlyOwner {
        require(_burnBps <= 2000, "burn > 20%");
        require(_treasuryBps <= 2000, "treasury > 20%");
        burnBps = _burnBps;
        treasuryBps = _treasuryBps;
        emit ConfigUpdated("feeSplit");
    }

    function setTierConfig(
        uint256 _baseBet,
        uint64 _baseDuration,
        uint64 _minDuration,
        uint32 _tierStep
    ) external onlyOwner {
        require(_baseBet > 0, "baseBet=0");
        require(_baseDuration >= 60 && _baseDuration <= 7 days, "duration range");
        require(_minDuration >= 10 && _minDuration <= _baseDuration, "minDur range");
        require(_tierStep >= 1, "tierStep=0");
        baseBet = _baseBet;
        baseDuration = _baseDuration;
        minDuration = _minDuration;
        tierStep = _tierStep;
        emit ConfigUpdated("tier");
    }

    // ---------- Tier math (bet floor & timer per tier) ----------

    /// Tier for a given bet count (= betCount / tierStep), capped at MAX_TIER.
    function tierAt(uint32 betCount) public view returns (uint8) {
        uint256 t = betCount / tierStep;
        return t >= MAX_TIER ? MAX_TIER : uint8(t);
    }

    /// Bet floor for a tier: baseBet doubled per tier (baseBet << tier).
    function betFloorForTier(uint8 tier) public view returns (uint256) {
        return baseBet << tier;
    }

    /// Round timer for a tier: baseDuration halved per tier, floored.
    function durationForTier(uint8 tier) public view returns (uint64) {
        uint64 d = baseDuration >> tier;
        return d < minDuration ? minDuration : d;
    }

    /// Bet floor a NEW bet must meet right now (tier 0 if the round is fresh
    /// or already expired). The page reads this to submit exactly the minimum.
    function currentMinBet() external view returns (uint256) {
        Round storage r = rounds[currentRoundId];
        bool fresh = r.deadline == 0 || block.timestamp > r.deadline;
        return betFloorForTier(tierAt(fresh ? 0 : r.betCount));
    }

    /// Current tier for the live round (0 if fresh/expired).
    function currentTier() external view returns (uint8) {
        Round storage r = rounds[currentRoundId];
        bool fresh = r.deadline == 0 || block.timestamp > r.deadline;
        return tierAt(fresh ? 0 : r.betCount);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    /**
     * Withdraw EXCESS tokens only (sent here by mistake / dust). Must be
     * paused, and can never reduce the balance below liabilities =
     * outstanding credits + the live round's prize pool.
     */
    function withdrawToken(uint256 amount) external onlyOwner {
        require(paused, "must be paused");
        require(amount > 0, "amount=0");
        uint256 bal = token.balanceOf(address(this));
        uint256 liabilities = totalPendingPrize + rounds[currentRoundId].prizePool;
        require(bal >= liabilities, "liabilities exceed balance");
        require(amount <= bal - liabilities, "would touch liabilities");
        _safeTransfer(owner, amount, "transfer failed");
        emit TokenWithdrawn(owner, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------- SafeERC20 helpers ----------

    /**
     * SafeERC20-style helpers (source fix for future redeploys; deployed
     * bytecode is immutable). Tolerate non-standard ERC-20s — e.g. USDT-style
     * tokens that return no bool from transfer/transferFrom. Accept either no
     * return data or a returned `true`; revert otherwise. Inlined (no import)
     * to keep this contract self-contained for the repo's solc script.
     */
    function _safeTransfer(address to, uint256 amount, string memory errMsg) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), errMsg);
    }

    function _safeTransferFrom(
        address from,
        address to,
        uint256 amount,
        string memory errMsg
    ) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), errMsg);
    }

    // ---------- Views ----------

    /// Full info for the live round (id + struct fields in one call).
    function currentRound()
        external
        view
        returns (
            uint256 id,
            uint256 prizePool,
            uint256 totalBurned,
            uint64 deadline,
            address lastBettor,
            uint32 betCount,
            uint32 uniquePlayers,
            bool settled
        )
    {
        Round storage r = rounds[currentRoundId];
        return (
            currentRoundId,
            r.prizePool,
            r.totalBurned,
            r.deadline,
            r.lastBettor,
            r.betCount,
            r.uniquePlayers,
            r.settled
        );
    }
}
