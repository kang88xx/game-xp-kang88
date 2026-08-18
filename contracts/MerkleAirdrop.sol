// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MerkleAirdrop — multi-campaign ERC-20 airdrop. Two claim modes per campaign:
 *
 *   • Whitelist (merkleRoot != 0): per-wallet (address, amount) allocations
 *     proven with a Merkle proof. Call claim(id, amount, proof).
 *   • Public  (merkleRoot == 0): open claim — any wallet claims a fixed
 *     `amountPerClaim` once, first-come until the campaign is drained. Call
 *     claimPublic(id). No proof, no off-chain allocation list needed, so every
 *     visitor can claim straight from the chain.
 *
 * Self-contained (no imports) so it compiles in Remix or with plain solc.
 *
 * Flow:
 *   1. (Whitelist) Admin builds (address, amount) pairs off-chain and computes
 *      a Merkle root (see lib/merkle.ts — encoding MUST match below).
 *      (Public) Admin picks a fixed amount-per-wallet; no root.
 *   2. Admin approves this contract for `amount` of the reward token, then
 *      calls createCampaign(token, root, amount, endsAt, amountPerClaim, name)
 *      which pulls the tokens in and registers the campaign.
 *   3. Whitelisted users call claim(id, amount, proof); public users call
 *      claimPublic(id). Either way each wallet claims at most once on-chain.
 *   4. Admin can sweep() unclaimed tokens back out (e.g. after the campaign
 *      ends) and pause/unpause with setActive().
 *
 * Leaf encoding (double-hashed, OpenZeppelin StandardMerkleTree style — guards
 * against second-preimage attacks because leaf preimages are 32 bytes while
 * internal nodes hash 64 bytes):
 *
 *     leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
 *
 * Internal nodes use sorted-pair hashing:
 *
 *     parent = keccak256(a <= b ? (a,b) : (b,a))
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract MerkleAirdrop {
    address public owner;

    /// Sentinel `token` value meaning the campaign funds and pays out the
    /// native coin (XP) instead of an ERC-20. EIP-7528-style placeholder.
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    struct Campaign {
        address token;          // reward ERC-20
        bytes32 merkleRoot;     // root over (account, amount) leaves; 0 = public/open claim
        uint256 funded;         // total tokens deposited on creation
        uint256 claimed;        // total tokens claimed so far
        uint256 amountPerClaim; // fixed reward per wallet for public campaigns (merkleRoot == 0)
        uint64 endsAt;          // unix seconds; 0 = no expiry
        bool active;            // owner can pause
    }

    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;
    // campaignId => account => total tokens already claimed (cumulative).
    // v5: was a bool — tracking amounts lets a wallet whose allocation grew
    // via updateRoot claim the difference instead of being locked out.
    mapping(uint256 => mapping(address => uint256)) public claimedAmount;

    event CampaignCreated(
        uint256 indexed id,
        address indexed token,
        bytes32 merkleRoot,
        uint256 funded,
        uint64 endsAt,
        uint256 amountPerClaim,
        string name
    );
    event Claimed(uint256 indexed id, address indexed account, uint256 amount);
    event Swept(uint256 indexed id, address indexed to, uint256 amount);
    event CampaignEnded(uint256 indexed id);
    event WhitelistPublished(uint256 indexed id, address[] accounts, uint256[] amounts);
    event RootUpdated(uint256 indexed id, bytes32 newRoot, uint256 addedFunding);
    event ActiveSet(uint256 indexed id, bool active);
    event OwnerTransferred(address indexed from, address indexed to);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // ── v6: 운영자(operator) ────────────────────────────────────────────
    // 캠페인 생성·루트 갱신·화이트리스트 공개·일시정지는 operator 도 실행
    // 가능하다. 자금이 빠져나가는 sweep/endAndSweep 과 operator 관리,
    // 소유권 이전은 여전히 owner 전용 — 운영 권한과 자금 권한을 분리한다.
    mapping(address => bool) public operators;

    event OperatorSet(address indexed account, bool allowed);

    modifier onlyOperator() {
        require(msg.sender == owner || operators[msg.sender], "not operator");
        _;
    }

    function setOperator(address account, bool allowed) external onlyOwner {
        require(account != address(0), "operator=0");
        operators[account] = allowed;
        emit OperatorSet(account, allowed);
    }

    /**
     * Create + fund a campaign. The caller (owner) must have approved this
     * contract for at least `amount` of `token` beforehand.
     *
     * Pass merkleRoot != 0 for a whitelist campaign (amountPerClaim ignored),
     * or merkleRoot == 0 for a public/open campaign (amountPerClaim required —
     * the fixed reward each wallet gets). `name` is emitted in the event only
     * (not stored) so the frontend can label campaigns read from the chain.
     */
    function createCampaign(
        address token,
        bytes32 merkleRoot,
        uint256 amount,
        uint64 endsAt,
        uint256 amountPerClaim,
        string calldata name
    ) external payable onlyOperator returns (uint256 id) {
        require(token != address(0), "token=0");
        require(amount > 0, "amount=0");
        // Public campaigns (no root) must define a positive per-wallet reward.
        if (merkleRoot == bytes32(0)) {
            require(amountPerClaim > 0, "perClaim=0");
            require(amountPerClaim <= amount, "perClaim>amount");
        }

        id = ++campaignCount;
        campaigns[id] = Campaign({
            token: token,
            merkleRoot: merkleRoot,
            funded: amount,
            claimed: 0,
            amountPerClaim: amountPerClaim,
            endsAt: endsAt,
            active: true
        });

        _pullFunds(token, amount);
        emit CampaignCreated(id, token, merkleRoot, amount, endsAt, amountPerClaim, name);
    }

    /** Compat view (v4 ABI): true once the wallet has claimed anything. */
    function hasClaimed(uint256 id, address account) external view returns (bool) {
        return claimedAmount[id][account] > 0;
    }

    /**
     * Whitelist claim: prove your (msg.sender, amount) leaf — `amount` is the
     * CUMULATIVE allocation. Pays out `amount - claimedAmount`, so a wallet
     * whose allocation grew via updateRoot can claim the difference. Reverts
     * if there is nothing new to claim.
     */
    function claim(uint256 id, uint256 amount, bytes32[] calldata proof) external {
        Campaign storage c = campaigns[id];
        require(c.token != address(0), "no campaign");
        require(c.merkleRoot != bytes32(0), "use claimPublic"); // public path is claimPublic
        require(c.active, "inactive");
        require(c.endsAt == 0 || block.timestamp <= c.endsAt, "ended");

        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(msg.sender, amount)))
        );
        require(_verify(proof, c.merkleRoot, leaf), "bad proof");

        uint256 already = claimedAmount[id][msg.sender];
        require(amount > already, "nothing to claim");
        uint256 payout = amount - already;

        // Effects before interaction (reentrancy-safe).
        claimedAmount[id][msg.sender] = amount;
        c.claimed += payout;
        require(c.claimed <= c.funded, "exhausted");

        _send(c.token, msg.sender, payout);
        emit Claimed(id, msg.sender, payout);
    }

    /**
     * Public claim: any wallet claims the campaign's fixed amountPerClaim once,
     * first-come until funds run out. No proof — the campaign is open by design.
     */
    function claimPublic(uint256 id) external {
        Campaign storage c = campaigns[id];
        require(c.token != address(0), "no campaign");
        require(c.merkleRoot == bytes32(0), "use claim"); // whitelist path is claim
        require(c.active, "inactive");
        require(c.endsAt == 0 || block.timestamp <= c.endsAt, "ended");
        require(claimedAmount[id][msg.sender] == 0, "already claimed");

        uint256 amount = c.amountPerClaim;
        require(c.claimed + amount <= c.funded, "exhausted");

        // Effects before interaction (reentrancy-safe).
        claimedAmount[id][msg.sender] = amount;
        c.claimed += amount;

        _send(c.token, msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    /**
     * Owner reclaims still-unclaimed tokens — ONLY after the campaign's end
     * time has passed. This guarantees claimers a guaranteed window: the owner
     * cannot pull funds out from under an active campaign (anti-rug). Campaigns
     * with no end date (endsAt == 0) are intentionally non-sweepable; their
     * funds stay committed forever.
     */
    function sweep(uint256 id, address to) external onlyOwner {
        require(to != address(0), "to=0");
        Campaign storage c = campaigns[id];
        require(c.token != address(0), "no campaign");
        require(c.endsAt != 0 && block.timestamp > c.endsAt, "not ended");

        uint256 left = c.funded - c.claimed;
        require(left > 0, "nothing to sweep");

        c.active = false;
        c.funded = c.claimed; // prevent re-sweep
        _send(c.token, to, left);
        emit Swept(id, to, left);
    }

    /**
     * Replace a whitelist campaign's Merkle root — the "grow the whitelist
     * after launch" path. Rebuild the root off-chain over the FULL cumulative
     * allocation list, then top up funding for the newly added allocations in
     * the same call (addAmount > 0 needs a prior ERC20 approve). Follow with
     * publishWhitelist(full list) so visitors can rebuild their proofs.
     * Owner-trust note: this lets the owner change unclaimed allocations.
     * A wallet that already claimed can claim again only for the DIFFERENCE
     * between its new cumulative allocation and claimedAmount (v5).
     *
     * SECURITY (source fix for future redeploys; deployed bytecode is
     * immutable): this is OWNER-ONLY, not onlyOperator. The Merkle root IS
     * fund control — an operator who could set an arbitrary root could
     * allocate the whole campaign balance to their own wallet and claim it,
     * bypassing the owner-only sweep/endAndSweep guards. Root updates must
     * carry the same trust level as moving funds out, so they stay with the
     * owner. Operators keep genuinely operational powers only (createCampaign
     * with their own funds, publishWhitelist, setActive).
     */
    function updateRoot(
        uint256 id,
        bytes32 newRoot,
        uint256 addAmount
    ) external payable onlyOwner {
        Campaign storage c = campaigns[id];
        require(c.token != address(0), "no campaign");
        require(c.merkleRoot != bytes32(0), "public campaign");
        require(newRoot != bytes32(0), "root=0");

        c.merkleRoot = newRoot;
        if (addAmount > 0) {
            c.funded += addAmount;
            _pullFunds(c.token, addAmount);
        } else {
            require(msg.value == 0, "no native");
        }
        emit RootUpdated(id, newRoot, addAmount);
    }

    /**
     * Publish a whitelist campaign's (account, amount) allocations as an event —
     * pure data availability, nothing stored. Lets ANY visitor (not just the
     * admin who built the list) read the allocations back from the chain and
     * reconstruct their Merkle proof to claim. Emit-only: gas is the log cost of
     * the arrays, so split very large whitelists across multiple calls.
     */
    function publishWhitelist(
        uint256 id,
        address[] calldata accounts,
        uint256[] calldata amounts
    ) external onlyOperator {
        require(campaigns[id].token != address(0), "no campaign");
        require(accounts.length == amounts.length, "length mismatch");
        emit WhitelistPublished(id, accounts, amounts);
    }

    /**
     * Force-end a campaign NOW and sweep its unclaimed balance to `to` in the
     * same call. Owner override of the ends-at window that sweep() honors —
     * claims stop immediately, so use deliberately (claimers lose any time
     * they were promised). For already-ended campaigns this is just a
     * convenience one-click sweep.
     *
     * RESTRICTION (source fix for future redeploys; deployed bytecode is
     * immutable): only DATED campaigns (endsAt != 0) are force-endable.
     * Permanent campaigns (endsAt == 0) are documented as "funds committed
     * forever" and sweep() rejects them; without this guard endAndSweep could
     * force-set endsAt and sweep them, a single-key rug vector that breaks the
     * anti-rug guarantee. Permanent campaigns therefore stay non-endable here.
     */
    function endAndSweep(uint256 id, address to) external onlyOwner {
        require(to != address(0), "to=0");
        Campaign storage c = campaigns[id];
        require(c.token != address(0), "no campaign");
        require(c.endsAt != 0, "permanent campaign: not force-endable");

        c.active = false;
        // Pull the end time back so claim()'s `block.timestamp <= endsAt`
        // check fails from this block onward (and sweep() stays consistent).
        if (c.endsAt == 0 || c.endsAt >= block.timestamp) {
            c.endsAt = uint64(block.timestamp - 1);
        }
        emit CampaignEnded(id);

        uint256 left = c.funded - c.claimed;
        if (left > 0) {
            c.funded = c.claimed; // prevent re-sweep
            _send(c.token, to, left);
            emit Swept(id, to, left);
        }
    }

    function setActive(uint256 id, bool active_) external onlyOperator {
        require(campaigns[id].token != address(0), "no campaign");
        campaigns[id].active = active_;
        emit ActiveSet(id, active_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    /** Tokens still claimable for a campaign. */
    function remaining(uint256 id) external view returns (uint256) {
        Campaign storage c = campaigns[id];
        return c.funded - c.claimed;
    }

    /**
     * Pull `amount` of `token` in to fund a campaign: the native coin via
     * msg.value (must match exactly), or an ERC-20 transferFrom (needs a prior
     * approve, and rejects stray native).
     */
    function _pullFunds(address token, uint256 amount) internal {
        if (token == NATIVE) {
            require(msg.value == amount, "bad msg.value");
        } else {
            require(msg.value == 0, "no native");
            _safeTransferFrom(token, msg.sender, address(this), amount, "fund failed");
        }
    }

    /**
     * Pay `amount` of `token` out to `to`: the native coin via call, or an
     * ERC-20 transfer. Reverts on failure (checks-effects-interactions in
     * callers keeps this reentrancy-safe).
     */
    function _send(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok, ) = payable(to).call{value: amount}("");
            require(ok, "native xfer failed");
        } else {
            _safeTransfer(token, to, amount, "transfer failed");
        }
    }

    /**
     * SafeERC20-style helpers (source fix for future redeploys; deployed
     * bytecode is immutable). Tolerate non-standard ERC-20s — e.g. USDT-style
     * tokens that return no bool from transfer/transferFrom. Accept either no
     * return data or a returned `true`; revert otherwise. Inlined (no import)
     * to keep this contract self-contained for the repo's solc script.
     */
    function _safeTransfer(
        address token,
        address to,
        uint256 amount,
        string memory errMsg
    ) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(
            ok && (data.length == 0 || abi.decode(data, (bool))),
            errMsg
        );
    }

    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount,
        string memory errMsg
    ) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(
            ok && (data.length == 0 || abi.decode(data, (bool))),
            errMsg
        );
    }

    function _verify(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h <= p
                ? keccak256(abi.encodePacked(h, p))
                : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
