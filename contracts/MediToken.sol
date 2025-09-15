// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20; // ⬅️ OZ v5 needs >= 0.8.20

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MediToken
 * @dev ERC20 token for rewarding medicine verifications
 */
contract MediToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18; // 1 million tokens

    mapping(address => bool) public minters;

    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);

    // ⬅️ In OZ v5, pass the initial owner to Ownable()
    constructor() ERC20("MediTrust Token", "MEDI") Ownable(msg.sender) {
        // Mint initial supply to owner for liquidity
        _mint(msg.sender, 100_000 * 10 ** 18); // 100k tokens
        minters[msg.sender] = true;
    }

    modifier onlyMinter() {
        require(minters[msg.sender], "Not a minter");
        _;
    }

    function addMinter(address _minter) external onlyOwner {
        minters[_minter] = true;
        emit MinterAdded(_minter);
    }

    function removeMinter(address _minter) external onlyOwner {
        minters[_minter] = false;
        emit MinterRemoved(_minter);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
