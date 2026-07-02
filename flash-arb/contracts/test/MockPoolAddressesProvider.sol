// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test-only stand-in for Aave's PoolAddressesProvider so FlashArbitrage
///      can be deployed on a local Hardhat network without a mainnet fork.
contract MockPoolAddressesProvider {
    address public pool;

    constructor(address _pool) {
        pool = _pool;
    }

    function getPool() external view returns (address) {
        return pool;
    }
}
