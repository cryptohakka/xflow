// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * XFlow Analytics Contract v2
 * Records AI agent swap activity + A2A calls on X Layer
 */
contract XFlowAnalytics {

    // ── Structs ──────────────────────────────────────────────

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
        string txHash;          // NEW: swap TX hash on X Layer
    }

    struct FailedSwapRecord {
        address agent;
        string fromToken;
        string toToken;
        uint256 fromAmount;
        string reason;          // "risk_rejected" | "broadcast_failed"
        string paymentNetwork;
        uint256 timestamp;
    }

    struct A2ACallRecord {
        address callerAgent;    // XFlow orchestrator address
        string externalAgent;   // e.g. "ClawdMint", "SomeOtherAgent"
        string purpose;         // e.g. "swap_confirmation", "risk_analysis"
        uint256 feePaid;        // in USDC (6 decimals), e.g. 1000 = $0.001
        string paymentNetwork;  // chain used for x402 payment
        uint256 timestamp;
    }

    // ── Events ───────────────────────────────────────────────

    event SwapExecuted(
        address indexed agent,
        string fromToken,
        string toToken,
        uint256 fromAmount,
        uint256 toAmount,
        string paymentNetwork,
        string route,
        uint8 riskLevel,
        uint256 timestamp,
        string txHash           // NEW
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

    event A2ACallMade(
        address indexed callerAgent,
        string externalAgent,
        string purpose,
        uint256 feePaid,
        string paymentNetwork,
        uint256 timestamp
    );

    // ── State ─────────────────────────────────────────────────

    SwapRecord[]       public swaps;
    FailedSwapRecord[] public failedSwaps;
    A2ACallRecord[]    public a2aCalls;

    mapping(address => uint256) public agentSwapCount;
    mapping(address => uint256) public agentFailedCount;
    mapping(address => uint256) public agentA2ACallCount;
    mapping(string  => uint256) public externalAgentCallCount; // e.g. "ClawdMint" => 42

    uint256 public totalSwaps;
    uint256 public totalFailed;
    uint256 public totalA2ACalls;
    uint256 public totalVolume;   // cumulative fromAmount (USDC 6 decimals)

    address public owner;

    constructor() {
        owner = msg.sender;
    }

    // ── Write functions ───────────────────────────────────────

    function recordSwap(
        address agent,
        string calldata fromToken,
        string calldata toToken,
        uint256 fromAmount,
        uint256 toAmount,
        string calldata paymentNetwork,
        string calldata route,
        uint8 riskLevel,
        string calldata txHash      // NEW
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
            timestamp: block.timestamp,
            txHash: txHash
        }));

        agentSwapCount[agent]++;
        totalSwaps++;
        totalVolume += fromAmount;

        emit SwapExecuted(
            agent, fromToken, toToken, fromAmount, toAmount,
            paymentNetwork, route, riskLevel, block.timestamp, txHash
        );
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

        emit SwapFailed(
            agent, fromToken, toToken, fromAmount,
            reason, paymentNetwork, block.timestamp
        );
    }

    function recordA2ACall(
        address callerAgent,
        string calldata externalAgent,
        string calldata purpose,
        uint256 feePaid,
        string calldata paymentNetwork
    ) external {
        a2aCalls.push(A2ACallRecord({
            callerAgent: callerAgent,
            externalAgent: externalAgent,
            purpose: purpose,
            feePaid: feePaid,
            paymentNetwork: paymentNetwork,
            timestamp: block.timestamp
        }));

        agentA2ACallCount[callerAgent]++;
        externalAgentCallCount[externalAgent]++;
        totalA2ACalls++;

        emit A2ACallMade(
            callerAgent, externalAgent, purpose,
            feePaid, paymentNetwork, block.timestamp
        );
    }

    // ── Read functions ────────────────────────────────────────

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

    function getRecentA2ACalls(uint256 count) external view returns (A2ACallRecord[] memory) {
        uint256 len = a2aCalls.length;
        uint256 resultLen = count > len ? len : count;
        A2ACallRecord[] memory result = new A2ACallRecord[](resultLen);
        for (uint256 i = 0; i < resultLen; i++) {
            result[i] = a2aCalls[len - resultLen + i];
        }
        return result;
    }

    function getSuccessRate() external view returns (uint256 numerator, uint256 denominator) {
        denominator = totalSwaps + totalFailed;
        numerator = totalSwaps;
    }
}
