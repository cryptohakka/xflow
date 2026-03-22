// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
        string txHash;
    }

    struct FailedSwapRecord {
        address agent;
        string fromToken;
        string toToken;
        uint256 fromAmount;
        string reason;
        string paymentNetwork;
        uint256 timestamp;
    }

    struct A2ACallRecord {
        address callerAgent;
        string externalAgent;
        string purpose;
        uint256 feePaid;
        string paymentNetwork;
        uint256 timestamp;
    }

    struct X402PaymentRecord {
        address agent;
        string endpoint;
        uint256 feePaid;
        string paymentNetwork;
        string paymentTxHash;
        uint256 timestamp;
    }

    event SwapExecuted(address indexed agent, string fromToken, string toToken, uint256 fromAmount, uint256 toAmount, string paymentNetwork, string route, uint8 riskLevel, uint256 timestamp, string txHash);
    event SwapFailed(address indexed agent, string fromToken, string toToken, uint256 fromAmount, string reason, string paymentNetwork, uint256 timestamp);
    event A2ACallMade(address indexed callerAgent, string externalAgent, string purpose, uint256 feePaid, string paymentNetwork, uint256 timestamp);
    event X402PaymentMade(address indexed agent, string endpoint, uint256 feePaid, string paymentNetwork, string paymentTxHash, uint256 timestamp);

    SwapRecord[]        public swaps;
    FailedSwapRecord[]  public failedSwaps;
    A2ACallRecord[]     public a2aCalls;
    X402PaymentRecord[] public x402Payments;

    mapping(address => uint256) public agentSwapCount;
    mapping(address => uint256) public agentFailedCount;
    mapping(address => uint256) public agentA2ACallCount;
    mapping(address => uint256) public agentX402Count;
    mapping(string  => uint256) public externalAgentCallCount;
    mapping(string  => uint256) public endpointPaymentCount;

    uint256 public totalSwaps;
    uint256 public totalFailed;
    uint256 public totalA2ACalls;
    uint256 public totalX402Payments;
    uint256 public totalVolume;
    uint256 public totalX402Fees;

    address public owner;
    constructor() { owner = msg.sender; }

    function recordSwap(address agent, string calldata fromToken, string calldata toToken, uint256 fromAmount, uint256 toAmount, string calldata paymentNetwork, string calldata route, uint8 riskLevel, string calldata txHash) external {
        swaps.push(SwapRecord({ agent: agent, fromToken: fromToken, toToken: toToken, fromAmount: fromAmount, toAmount: toAmount, paymentNetwork: paymentNetwork, route: route, riskLevel: riskLevel, timestamp: block.timestamp, txHash: txHash }));
        agentSwapCount[agent]++; totalSwaps++; totalVolume += fromAmount;
        emit SwapExecuted(agent, fromToken, toToken, fromAmount, toAmount, paymentNetwork, route, riskLevel, block.timestamp, txHash);
    }

    function recordFailedSwap(address agent, string calldata fromToken, string calldata toToken, uint256 fromAmount, string calldata reason, string calldata paymentNetwork) external {
        failedSwaps.push(FailedSwapRecord({ agent: agent, fromToken: fromToken, toToken: toToken, fromAmount: fromAmount, reason: reason, paymentNetwork: paymentNetwork, timestamp: block.timestamp }));
        agentFailedCount[agent]++; totalFailed++;
        emit SwapFailed(agent, fromToken, toToken, fromAmount, reason, paymentNetwork, block.timestamp);
    }

    function recordA2ACall(address callerAgent, string calldata externalAgent, string calldata purpose, uint256 feePaid, string calldata paymentNetwork) external {
        a2aCalls.push(A2ACallRecord({ callerAgent: callerAgent, externalAgent: externalAgent, purpose: purpose, feePaid: feePaid, paymentNetwork: paymentNetwork, timestamp: block.timestamp }));
        agentA2ACallCount[callerAgent]++; externalAgentCallCount[externalAgent]++; totalA2ACalls++;
        emit A2ACallMade(callerAgent, externalAgent, purpose, feePaid, paymentNetwork, block.timestamp);
    }

    function recordX402Payment(address agent, string calldata endpoint, uint256 feePaid, string calldata paymentNetwork, string calldata paymentTxHash) external {
        x402Payments.push(X402PaymentRecord({ agent: agent, endpoint: endpoint, feePaid: feePaid, paymentNetwork: paymentNetwork, paymentTxHash: paymentTxHash, timestamp: block.timestamp }));
        agentX402Count[agent]++; endpointPaymentCount[endpoint]++; totalX402Payments++; totalX402Fees += feePaid;
        emit X402PaymentMade(agent, endpoint, feePaid, paymentNetwork, paymentTxHash, block.timestamp);
    }

    function getRecentSwaps(uint256 count) external view returns (SwapRecord[] memory) {
        uint256 len = swaps.length; uint256 n = count > len ? len : count;
        SwapRecord[] memory r = new SwapRecord[](n);
        for (uint256 i = 0; i < n; i++) r[i] = swaps[len - n + i];
        return r;
    }

    function getRecentFailedSwaps(uint256 count) external view returns (FailedSwapRecord[] memory) {
        uint256 len = failedSwaps.length; uint256 n = count > len ? len : count;
        FailedSwapRecord[] memory r = new FailedSwapRecord[](n);
        for (uint256 i = 0; i < n; i++) r[i] = failedSwaps[len - n + i];
        return r;
    }

    function getRecentA2ACalls(uint256 count) external view returns (A2ACallRecord[] memory) {
        uint256 len = a2aCalls.length; uint256 n = count > len ? len : count;
        A2ACallRecord[] memory r = new A2ACallRecord[](n);
        for (uint256 i = 0; i < n; i++) r[i] = a2aCalls[len - n + i];
        return r;
    }

    function getRecentX402Payments(uint256 count) external view returns (X402PaymentRecord[] memory) {
        uint256 len = x402Payments.length; uint256 n = count > len ? len : count;
        X402PaymentRecord[] memory r = new X402PaymentRecord[](n);
        for (uint256 i = 0; i < n; i++) r[i] = x402Payments[len - n + i];
        return r;
    }

    function getSuccessRate() external view returns (uint256 numerator, uint256 denominator) {
        denominator = totalSwaps + totalFailed; numerator = totalSwaps;
    }
}
