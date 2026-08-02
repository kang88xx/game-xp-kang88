// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TestToken — a self-contained ERC-20 for BSC TESTNET only.
 *
 * Use this to mint a "pegged" test USDT (18 decimals, like BSC-peg USDT).
 * It has NO external imports, so it pastes straight into Remix and compiles
 * with zero setup.
 *
 * Deploy example (constructor args):
 *   name        = "Test Tether"
 *   symbol      = "USDT"
 *   initialMint = 1000000   (you receive 1,000,000 USDT, 18 decimals)
 *
 * "Pegging" note: this contract does NOT itself hold a $1 peg — on a DEX the
 * price is whatever your liquidity-pool ratio says. To make 1 USDT ≈ $1 you
 * seed a PancakeSwap testnet pool at the right ratio (see TESTNET.md). Anyone
 * can also call faucet() to grab test tokens.
 */
contract TestToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 initialMint) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        _mint(msg.sender, initialMint * 10 ** decimals);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /** Owner can mint any amount (whole tokens) to any address. */
    function mint(address to, uint256 wholeTokens) external onlyOwner {
        _mint(to, wholeTokens * 10 ** decimals);
    }

    /** Open faucet: anyone can grab 10,000 test tokens for testing. */
    function faucet() external {
        _mint(msg.sender, 10_000 * 10 ** decimals);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "zero addr");
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}
