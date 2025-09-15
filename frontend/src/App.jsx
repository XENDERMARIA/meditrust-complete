// MediTrust - Supply Chain Management Dashboard
// Complete medicine tracking from manufacturer to customer

import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Chain configurations
const CHAINS = {
  localhost: {
    chainId: '0x7a69',
    chainName: 'Local Hardhat',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['http://127.0.0.1:8545'],
    icon: '🏠',
    color: '#4A5568',
    gradient: 'linear-gradient(135deg, #4A5568 0%, #718096 100%)'
  },
  polygon: {
    chainId: '0x89',
    chainName: 'Polygon',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
    icon: '🟣',
    color: '#8247E5',
    gradient: 'linear-gradient(135deg, #8247E5 0%, #A473EE 100%)'
  },
  base: {
    chainId: '0x2105',
    chainName: 'Base',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
    icon: '🔵',
    color: '#0052FF',
    gradient: 'linear-gradient(135deg, #0052FF 0%, #4D8FFF 100%)'
  },
  arbitrum: {
    chainId: '0xa4b1',
    chainName: 'Arbitrum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
    icon: '🔷',
    color: '#28A0F0',
    gradient: 'linear-gradient(135deg, #28A0F0 0%, #5CB8F5 100%)'
  }
};

// Supply chain roles
const SUPPLY_CHAIN_ROLES = {
  TRANSPORTER: { label: 'Transporter', icon: '🚚', color: '#F59E0B' },
  SUPPLIER: { label: 'Supplier', icon: '📦', color: '#10B981' },
  DISTRIBUTOR: { label: 'Distributor', icon: '🏢', color: '#3B82F6' },
  WHOLESALER: { label: 'Wholesaler', icon: '🏪', color: '#8B5CF6' },
  RETAILER: { label: 'Retailer', icon: '🏬', color: '#EC4899' }
};

const API_URL = 'http://localhost:5000';

function App() {
  // State management
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState('');
  const [selectedChain, setSelectedChain] = useState('localhost');
  const [activeTab, setActiveTab] = useState('register');
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    clearNode: 'disconnected',
    activeChannels: 0,
    chains: {}
  });
  const [notifications, setNotifications] = useState([]);

  // Registration form state
  const [batchId, setBatchId] = useState('');
  const [drugName, setDrugName] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [participants, setParticipants] = useState([
    { address: '', role: 'TRANSPORTER' }
  ]);
  const [qrCode, setQrCode] = useState('');
  const [registrationResult, setRegistrationResult] = useState(null);

  // Verification state
  const [verifyBatchId, setVerifyBatchId] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [batchDetails, setBatchDetails] = useState(null);

  // Customer claim state
  const [claimBatchId, setClaimBatchId] = useState('');
  const [claimResult, setClaimResult] = useState(null);

  // Fetch system status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/health`);
        const data = await response.json();
        setSystemStatus(data);
      } catch (error) {
        console.error('Failed to fetch status:', error);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Notification system
  const notify = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Connect wallet
  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        });
        setAccount(accounts[0]);
        setConnected(true);
        notify('Wallet connected successfully', 'success');

        // Switch to selected chain
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: CHAINS[selectedChain].chainId }],
          });
        } catch (switchError) {
          // Chain doesn't exist, add it
          if (switchError.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [CHAINS[selectedChain]],
            });
          }
        }
      } catch (error) {
        notify('Failed to connect wallet', 'error');
      }
    } else {
      notify('Please install MetaMask', 'warning');
    }
  };

  // Add participant
  const addParticipant = () => {
    setParticipants([...participants, { address: '', role: 'TRANSPORTER' }]);
  };

  // Remove participant
  const removeParticipant = (index) => {
    setParticipants(participants.filter((_, i) => i !== index));
  };

  // Update participant
  const updateParticipant = (index, field, value) => {
    const updated = [...participants];
    updated[index][field] = value;
    setParticipants(updated);
  };

  // Register batch with supply chain
  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate participants
      const validParticipants = participants.filter(p => p.address);
      if (validParticipants.length === 0) {
        notify('Please add at least one supply chain participant', 'error');
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/register/${selectedChain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          drugName,
          ingredients,
          expiryDate,
          participants: validParticipants,
          useStateChannel: true
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setQrCode(result.qrCode);
        setRegistrationResult(result);
        notify(`Batch registered with ${result.participants} participants`, 'success');
        
        // Reset form
        setBatchId('');
        setDrugName('');
        setIngredients('');
        setExpiryDate('');
        setParticipants([{ address: '', role: 'TRANSPORTER' }]);
      } else {
        notify(result.error || 'Registration failed', 'error');
      }
    } catch (error) {
      notify('Registration failed: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Supply chain verification
  const handleSupplyChainVerify = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/verify/supply-chain/${selectedChain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: verifyBatchId,
          verifier: account,
          location: 'GPS: 40.7128, -74.0060', // Example location
          additionalData: 'Temperature: 2-8°C, Humidity: 45%'
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setVerificationResult(result);
        notify(`Verification successful! Progress: ${result.progress}`, 'success');
        
        // Fetch updated batch details
        await fetchBatchDetails(verifyBatchId);
      } else {
        notify(result.error || 'Verification failed', 'error');
      }
    } catch (error) {
      notify('Verification failed: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Customer claim reward
  const handleCustomerClaim = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/claim/${selectedChain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: claimBatchId,
          customer: account
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setClaimResult(result);
        notify(`🎉 Reward claimed! You received ${result.reward}`, 'success');
      } else {
        notify(result.error || 'Claim failed', 'error');
      }
    } catch (error) {
      notify('Claim failed: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Fetch batch details
  const fetchBatchDetails = async (batchId) => {
    try {
      const response = await fetch(`${API_URL}/api/batch/${selectedChain}/${batchId}`);
      const data = await response.json();
      setBatchDetails(data);
    } catch (error) {
      console.error('Failed to fetch batch details:', error);
    }
  };

  // Check batch status
  const checkBatchStatus = async () => {
    if (!verifyBatchId) {
      notify('Please enter a batch ID', 'warning');
      return;
    }
    
    setLoading(true);
    try {
      await fetchBatchDetails(verifyBatchId);
      notify('Batch details loaded', 'success');
    } catch (error) {
      notify('Failed to fetch batch details', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Animated Background */}
      <div className="animated-background">
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
        <div className="gradient-orb orb-3"></div>
        <div className="grid-overlay"></div>
      </div>

      {/* Notifications */}
      <div className="notifications-container">
        {notifications.map(notif => (
          <div key={notif.id} className={`notification ${notif.type}`}>
            <div className="notification-content">
              {notif.type === 'success' && <span className="notification-icon">✔</span>}
              {notif.type === 'error' && <span className="notification-icon">✕</span>}
              {notif.type === 'warning' && <span className="notification-icon">⚠</span>}
              {notif.type === 'info' && <span className="notification-icon">ℹ</span>}
              <span>{notif.message}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="header-container">
          <div className="brand">
            <div className="brand-icon">
              <span className="brand-emoji">🏥</span>
            </div>
            <div className="brand-text">
              <h1>MediTrust</h1>
              <span className="brand-subtitle">Supply Chain Management System</span>
            </div>
          </div>

          <div className="header-status">
            <div className={`status-indicator ${systemStatus.clearNode === 'connected' ? 'connected' : ''}`}>
              <span className="status-dot"></span>
              <span>ClearNode</span>
            </div>
            <div className="status-indicator">
              <span className="status-icon">📦</span>
              <span>{systemStatus.activeChannels || 0} Channels</span>
            </div>
          </div>

          <div className="header-actions">
            {connected ? (
              <div className="wallet-info">
                <div className="wallet-address">
                  <span className="address-label">Connected:</span>
                  <span className="address-text">
                    {account.substring(0, 6)}...{account.substring(38)}
                  </span>
                </div>
              </div>
            ) : (
              <button className="connect-button" onClick={connectWallet}>
                <span className="button-icon">🔗</span>
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-wrapper">
          {/* Chain Selector */}
          <div className="chain-selector">
            <h3 className="section-title">Select Blockchain Network</h3>
            <div className="chain-grid">
              {Object.entries(CHAINS).map(([key, chain]) => (
                <button
                  key={key}
                  className={`chain-card ${selectedChain === key ? 'selected' : ''}`}
                  onClick={() => setSelectedChain(key)}
                  style={{
                    background: selectedChain === key ? chain.gradient : 'rgba(255,255,255,0.05)',
                    borderColor: selectedChain === key ? chain.color : 'transparent'
                  }}
                >
                  <span className="chain-icon">{chain.icon}</span>
                  <span className="chain-name">{chain.chainName}</span>
                  {systemStatus.chains[key]?.contractsDeployed && (
                    <span className="chain-status">✓ Ready</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-button ${activeTab === 'register' ? 'active' : ''}`}
              onClick={() => setActiveTab('register')}
            >
              <span className="tab-icon">📝</span>
              Register Batch
            </button>
            <button
              className={`tab-button ${activeTab === 'verify' ? 'active' : ''}`}
              onClick={() => setActiveTab('verify')}
            >
              <span className="tab-icon">✅</span>
              Supply Chain Verify
            </button>
            <button
              className={`tab-button ${activeTab === 'claim' ? 'active' : ''}`}
              onClick={() => setActiveTab('claim')}
            >
              <span className="tab-icon">🎁</span>
              Customer Claim
            </button>
            <button
              className={`tab-button ${activeTab === 'track' ? 'active' : ''}`}
              onClick={() => setActiveTab('track')}
            >
              <span className="tab-icon">📍</span>
              Track Batch
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {/* Registration Tab */}
            {activeTab === 'register' && (
              <div className="registration-panel">
                <h2 className="panel-title">Register Medicine Batch</h2>
                <form onSubmit={handleRegister} className="registration-form">
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Batch ID</label>
                      <input
                        type="text"
                        value={batchId}
                        onChange={(e) => setBatchId(e.target.value)}
                        placeholder="e.g., BATCH-2024-001"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Drug Name</label>
                      <input
                        type="text"
                        value={drugName}
                        onChange={(e) => setDrugName(e.target.value)}
                        placeholder="e.g., Aspirin"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Ingredients</label>
                      <input
                        type="text"
                        value={ingredients}
                        onChange={(e) => setIngredients(e.target.value)}
                        placeholder="e.g., Acetylsalicylic acid"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Expiry Date</label>
                      <input
                        type="date"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="participants-section">
                    <h3>Supply Chain Participants</h3>
                    {participants.map((participant, index) => (
                      <div key={index} className="participant-row">
                        <div className="participant-inputs">
                          <input
                            type="text"
                            placeholder="Wallet address (0x...)"
                            value={participant.address}
                            onChange={(e) => updateParticipant(index, 'address', e.target.value)}
                            className="address-input"
                          />
                          <select
                            value={participant.role}
                            onChange={(e) => updateParticipant(index, 'role', e.target.value)}
                            className="role-select"
                          >
                            {Object.entries(SUPPLY_CHAIN_ROLES).map(([key, role]) => (
                              <option key={key} value={key}>
                                {role.icon} {role.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {participants.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeParticipant(index)}
                            className="remove-button"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addParticipant}
                      className="add-participant-button"
                    >
                      + Add Participant
                    </button>
                  </div>

                  <button type="submit" className="submit-button" disabled={loading}>
                    {loading ? (
                      <span className="loading-spinner">⟳</span>
                    ) : (
                      <>
                        <span className="button-icon">📦</span>
                        Register Batch
                      </>
                    )}
                  </button>
                </form>

                {qrCode && (
                  <div className="qr-result">
                    <h3>Registration Successful!</h3>
                    <img src={qrCode} alt="QR Code" className="qr-code" />
                    <p className="qr-info">
                      Batch ID: {registrationResult?.batchId}<br/>
                      Participants: {registrationResult?.participants}<br/>
                      Status: {registrationResult?.status}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Supply Chain Verification Tab */}
            {activeTab === 'verify' && (
              <div className="verification-panel">
                <h2 className="panel-title">Supply Chain Verification</h2>
                <div className="verify-form">
                  <div className="form-group">
                    <label>Batch ID</label>
                    <input
                      type="text"
                      value={verifyBatchId}
                      onChange={(e) => setVerifyBatchId(e.target.value)}
                      placeholder="Enter batch ID to verify"
                    />
                  </div>
                  <div className="button-group">
                    <button onClick={checkBatchStatus} className="secondary-button">
                      <span className="button-icon">🔍</span>
                      Check Status
                    </button>
                    <button onClick={handleSupplyChainVerify} className="primary-button" disabled={loading || !connected}>
                      <span className="button-icon">✅</span>
                      Verify Transfer
                    </button>
                  </div>
                </div>

                {verificationResult && (
                  <div className="verification-result">
                    <h3>Verification Complete</h3>
                    <div className="result-details">
                      <p><strong>Role:</strong> {verificationResult.role}</p>
                      <p><strong>Progress:</strong> {verificationResult.progress}</p>
                      <p><strong>Ready for Customer:</strong> {verificationResult.readyForCustomer ? 'Yes ✅' : 'No ❌'}</p>
                      <p><strong>Transaction:</strong> {verificationResult.transactionHash?.substring(0, 10)}...</p>
                    </div>
                  </div>
                )}

                {batchDetails && (
                  <div className="batch-details">
                    <h3>Batch Supply Chain Status</h3>
                    <div className="supply-chain-progress">
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{ width: `${(batchDetails.supplyChain.verifiedCount / batchDetails.supplyChain.totalParticipants) * 100}%` }}
                        ></div>
                      </div>
                      <p className="progress-text">{batchDetails.supplyChain.progress} Verified</p>
                    </div>
                    <div className="participants-list">
                      {batchDetails.supplyChain.participants.map((p, i) => (
                        <div key={i} className={`participant-card ${p.hasVerified ? 'verified' : ''}`}>
                          <div className="participant-header">
                            <span className="role-badge" style={{ backgroundColor: SUPPLY_CHAIN_ROLES[p.role]?.color }}>
                              {SUPPLY_CHAIN_ROLES[p.role]?.icon} {SUPPLY_CHAIN_ROLES[p.role]?.label}
                            </span>
                            {p.hasVerified && <span className="verified-badge">✅ Verified</span>}
                          </div>
                          <p className="participant-address">{p.address}</p>
                          {p.hasVerified && (
                            <div className="verification-info">
                              <p><strong>Location:</strong> {p.location}</p>
                              <p><strong>Data:</strong> {p.additionalData}</p>
                              <p><strong>Time:</strong> {new Date(p.verifiedAt * 1000).toLocaleString()}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Customer Claim Tab */}
            {activeTab === 'claim' && (
              <div className="claim-panel">
                <h2 className="panel-title">Customer Reward Claim</h2>
                <div className="claim-form">
                  <div className="form-group">
                    <label>Batch ID (from QR Code)</label>
                    <input
                      type="text"
                      value={claimBatchId}
                      onChange={(e) => setClaimBatchId(e.target.value)}
                      placeholder="Scan or enter batch ID"
                    />
                  </div>
                  <button onClick={handleCustomerClaim} className="claim-button" disabled={loading || !connected}>
                    {loading ? (
                      <span className="loading-spinner">⟳</span>
                    ) : (
                      <>
                        <span className="button-icon">🎁</span>
                        Claim Reward
                      </>
                    )}
                  </button>
                </div>

                {claimResult && (
                  <div className="claim-result success">
                    <h3>🎉 Congratulations!</h3>
                    <p>You have successfully claimed your reward!</p>
                    <div className="reward-details">
                      <p><strong>Reward:</strong> {claimResult.reward}</p>
                      <p><strong>Transaction:</strong> {claimResult.transactionHash?.substring(0, 20)}...</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Track Batch Tab */}
            {activeTab === 'track' && (
              <div className="track-panel">
                <h2 className="panel-title">Track Medicine Batch</h2>
                <div className="track-form">
                  <div className="form-group">
                    <label>Enter Batch ID</label>
                    <input
                      type="text"
                      value={verifyBatchId}
                      onChange={(e) => setVerifyBatchId(e.target.value)}
                      placeholder="Track batch journey"
                    />
                  </div>
                  <button onClick={checkBatchStatus} className="track-button" disabled={loading}>
                    <span className="button-icon">📍</span>
                    Track Batch
                  </button>
                </div>

                {batchDetails && (
                  <div className="tracking-timeline">
                    <h3>Supply Chain Journey</h3>
                    <div className="timeline">
                      <div className="timeline-item">
                        <div className="timeline-marker completed">📝</div>
                        <div className="timeline-content">
                          <h4>Registered</h4>
                          <p>By: {batchDetails.manufacturer}</p>
                          <p>{new Date(batchDetails.registeredAt * 1000).toLocaleString()}</p>
                        </div>
                      </div>
                      {batchDetails.supplyChain.participants.map((p, i) => (
                        <div key={i} className="timeline-item">
                          <div className={`timeline-marker ${p.hasVerified ? 'completed' : 'pending'}`}>
                            {SUPPLY_CHAIN_ROLES[p.role]?.icon}
                          </div>
                          <div className="timeline-content">
                            <h4>{SUPPLY_CHAIN_ROLES[p.role]?.label}</h4>
                            {p.hasVerified ? (
                              <>
                                <p>✅ Verified at {p.location}</p>
                                <p>{new Date(p.verifiedAt * 1000).toLocaleString()}</p>
                              </>
                            ) : (
                              <p>⏳ Pending verification</p>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="timeline-item">
                        <div className={`timeline-marker ${batchDetails.supplyChain.rewardClaimed ? 'completed' : 'pending'}`}>
                          🎁
                        </div>
                        <div className="timeline-content">
                          <h4>Customer Delivery</h4>
                          {batchDetails.supplyChain.rewardClaimed ? (
                            <>
                              <p>✅ Delivered to customer</p>
                              <p>Reward claimed by: {batchDetails.supplyChain.rewardClaimedBy}</p>
                            </>
                          ) : batchDetails.supplyChain.readyForCustomer ? (
                            <p>✅ Ready for customer claim</p>
                          ) : (
                            <p>⏳ Awaiting supply chain completion</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;