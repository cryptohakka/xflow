// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * XFlow Analytics Contract
 * Records AI agent swap activity on X Layer
 */
contract XFlowAnalytics {
    
    struct SwapRecord {
        address agent;
        string fromToken;
        string toToken;
        uint256 fromAmount;  // in smallest unit
        uint256 toAmount;
        string paymentNetwork; // chain used for x402 payment
        string route;          // DEX route used
        uint8 riskLevel;       // 0=LOW, 1=MEDIUM, 2=HIGH
        uint256 timestamp;
    }

    event SwapExecuted(
        address indexed agent,
        string fromToken,
        string toToken,
        uint256 fromAmount,
        uint256 toAmount,
        string paymentNetwork,
        string route,
        uint8 riskLevel,
        uint256 timestamp
    );

    SwapRecord[] public swaps;
    mapping(address => uint256) public agentSwapCount;
    uint256 public totalSwaps;
    
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function recordSwap(
        address agent,
        string calldata fromToken,
        string calldata toToken,
        uint256 fromAmount,
        uint256 toAmount,
        string calldata paymentNetwork,
        string calldata route,
        uint8 riskLevel
    ) external {
        SwapRecord memory record = SwapRecord({
            agent: agent,
            fromToken: fromToken,
            toToken: toToken,
            fromAmount: fromAmount,
            toAmount: toAmount,
            paymentNetwork: paymentNetwork,
            route: route,
            riskLevel: riskLevel,
            timestamp: block.timestamp
        });
        
        swaps.push(record);
        agentSwapCount[agent]++;
        totalSwaps++;

        emit SwapExecuted(
            agent,
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            paymentNetwork,
            route,
            riskLevel,
            block.timestamp
        );
    }

    function getSwap(uint256 index) external view returns (SwapRecord memory) {
        return swaps[index];
    }

    function getRecentSwaps(uint256 count) external view returns (SwapRecord[] memory) {
        uint256 len = swaps.length;
        uint256 resultLen = count > len ? len : count;
        SwapRecord[] memory result = new SwapRecord[](resultLen);
        for (uint256 i = 0; i < resultLen; i++) {
            result[i] = swaps[len - resultLen + i];
        }
        return result;
    }
}
