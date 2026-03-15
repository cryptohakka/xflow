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
        uint256 fromAmount;
        uint256 toAmount;
        string paymentNetwork;
        string route;
        uint8 riskLevel;
        uint256 timestamp;
    }

    struct FailedSwapRecord {
        address agent;
        string fromToken;
        string toToken;
        uint256 fromAmount;
        string reason;      // "risk_rejected" | "broadcast_failed"
        string paymentNetwork;
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

    event SwapFailed(
        address indexed agent,
        string fromToken,
        string toToken,
        uint256 fromAmount,
        string reason,
        string paymentNetwork,
        uint256 timestamp
    );

    SwapRecord[] public swaps;
    FailedSwapRecord[] public failedSwaps;

    mapping(address => uint256) public agentSwapCount;
    mapping(address => uint256) public agentFailedCount;

    uint256 public totalSwaps;
    uint256 public totalFailed;

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
        swaps.push(SwapRecord({
            agent: agent,
            fromToken: fromToken,
            toToken: toToken,
            fromAmount: fromAmount,
            toAmount: toAmount,
            paymentNetwork: paymentNetwork,
            route: route,
            riskLevel: riskLevel,
            timestamp: block.timestamp
        }));
        agentSwapCount[agent]++;
        totalSwaps++;

        emit SwapExecuted(agent, fromToken, toToken, fromAmount, toAmount, paymentNetwork, route, riskLevel, block.timestamp);
    }

    function recordFailedSwap(
        address agent,
        string calldata fromToken,
        string calldata toToken,
        uint256 fromAmount,
        string calldata reason,
        string calldata paymentNetwork
    ) external {
        failedSwaps.push(FailedSwapRecord({
            agent: agent,
            fromToken: fromToken,
            toToken: toToken,
            fromAmount: fromAmount,
            reason: reason,
            paymentNetwork: paymentNetwork,
            timestamp: block.timestamp
        }));
        agentFailedCount[agent]++;
        totalFailed++;

        emit SwapFailed(agent, fromToken, toToken, fromAmount, reason, paymentNetwork, block.timestamp);
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

    function getRecentFailedSwaps(uint256 count) external view returns (FailedSwapRecord[] memory) {
        uint256 len = failedSwaps.length;
        uint256 resultLen = count > len ? len : count;
        FailedSwapRecord[] memory result = new FailedSwapRecord[](resultLen);
        for (uint256 i = 0; i < resultLen; i++) {
            result[i] = failedSwaps[len - resultLen + i];
        }
        return result;
    }

    function getSuccessRate() external view returns (uint256 numerator, uint256 denominator) {
        denominator = totalSwaps + totalFailed;
        numerator = totalSwaps;
    }
}
