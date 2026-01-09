import React, { useState, useEffect } from 'react';
import { getAllChallenges, searchChallenges } from '../../../services/challenges';
import { getChallengeStatus } from '../../../services/challenges';
import ChallengeTable from './ChallengeTable/ChallengeTable';
import AddChallengeModal from './AddChallengeModal/AddChallengeModal';
import ChallengeDetailModal from './ChallengeDetailModal/ChallengeDetailModal';
import Toast from '../../Common/Toast/Toast';
import LoadingSpinner from '../../Common/Loading/LoadingSpinner';
import SearchBar from '../UserManagement/SearchBar/SearchBar';
import './ChallengeManagement.css';

const ChallengeManagement = () => {
  const [challenges, setChallenges] = useState([]);
  const [filteredChallenges, setFilteredChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [toast, setToast] = useState(null);
  const [viewMode, setViewMode] = useState('all'); // 'all', 'recent'

  // Fetch challenges
  useEffect(() => {
    fetchChallenges();
  }, [viewMode]);

  // Filter challenges based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredChallenges(getDisplayChallenges());
      return;
    }

    const filterChallenges = async () => {
      const result = await searchChallenges(searchTerm);
      if (result.success) {
        setFilteredChallenges(result.data);
      } else {
        setFilteredChallenges([]);
      }
    };

    filterChallenges();
  }, [searchTerm, challenges, viewMode]);

  const fetchChallenges = async () => {
    try {
      setLoading(true);
      const result = await getAllChallenges();
      
      if (result.success) {
        setChallenges(result.data);
        setFilteredChallenges(getDisplayChallenges(result.data));
      } else {
        showToast('error', 'Failed to load challenges');
      }
    } catch (error) {
      console.error('Error fetching challenges:', error);
      showToast('error', 'Error loading challenges');
    } finally {
      setLoading(false);
    }
  };

  const getDisplayChallenges = (challengeList = challenges) => {
    if (viewMode === 'recent') {
      return challengeList.slice(0, 3);
    }
    return challengeList;
  };

  const handleSearch = (term) => {
    setSearchTerm(term);
  };

  const handleAddChallenge = () => {
    setShowAddModal(true);
  };

  const handleChallengeAdded = (newChallenge) => {
    setChallenges([newChallenge, ...challenges]);
    setFilteredChallenges([newChallenge, ...filteredChallenges]);
    showToast('success', 'Challenge created successfully');
  };

  const handleChallengeUpdated = (updatedChallenge) => {
    const updatedChallenges = challenges.map(challenge => 
      challenge.id === updatedChallenge.id ? updatedChallenge : challenge
    );
    setChallenges(updatedChallenges);
    setFilteredChallenges(updatedChallenges);
    showToast('success', 'Challenge updated successfully');
  };

  const handleChallengeDeleted = (challengeId) => {
    const updatedChallenges = challenges.filter(challenge => challenge.id !== challengeId);
    setChallenges(updatedChallenges);
    setFilteredChallenges(updatedChallenges);
    showToast('success', 'Challenge deleted successfully');
  };

  const handleChallengeClick = (challenge) => {
    setSelectedChallenge(challenge);
  };

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  const getStats = () => {
    const totalChallenges = challenges.length;
    const finished = challenges.filter(c => getChallengeStatus(c) === 'finished').length;
    const incoming = challenges.filter(c => getChallengeStatus(c) === 'incoming').length;
    const ongoing = challenges.filter(c => getChallengeStatus(c) === 'ongoing').length;

    return { totalChallenges, finished, incoming, ongoing };
  };

  const stats = getStats();

  return (
    <div className="challenge-management">
      {/* Header with Stats */}
      <div className="challenge-header">
        <div className="header-left">
          <h2>Challenge Management</h2>
          <p className="challenge-subtitle">Create and manage motivational challenges</p>
        </div>
        <div className="header-right">
          <button 
            className="add-challenge-button"
            onClick={handleAddChallenge}
            aria-label="Create new challenge"
          >
            <span className="button-icon">➕</span>
            <span className="button-text">Create Challenge</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalChallenges}</div>
            <div className="stat-label">Total Challenge</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.finished}</div>
            <div className="stat-label">Finished</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.incoming}</div>
            <div className="stat-label">Incoming</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔄</div>
          <div className="stat-content">
            <div className="stat-value">{stats.ongoing}</div>
            <div className="stat-label">Ongoing</div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="challenge-controls">
        <div className="view-toggles">
          <button 
            className={`view-toggle ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => setViewMode('all')}
          >
            All Challenges
          </button>
          <button 
            className={`view-toggle ${viewMode === 'recent' ? 'active' : ''}`}
            onClick={() => setViewMode('recent')}
          >
            Recent
          </button>
        </div>
        
        <div className="search-section">
          <SearchBar 
            onSearch={handleSearch}
            placeholder="Search challenges by title, description, or department..."
          />
          <div className="search-info">
            {searchTerm && (
              <span className="search-results">
                Found {filteredChallenges.length} results for "{searchTerm}"
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Challenges Table */}
      <div className="challenge-table-container">
        {loading ? (
          <div className="loading-container">
            <LoadingSpinner size="large" />
            <p>Loading challenges...</p>
          </div>
        ) : filteredChallenges.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎯</div>
            <h3>No challenges found</h3>
            <p>
              {searchTerm 
                ? 'No challenges match your search. Try a different term.'
                : 'No challenges in the system yet. Create your first challenge!'
              }
            </p>
            {!searchTerm && (
              <button 
                className="empty-action-button"
                onClick={handleAddChallenge}
              >
                Create First Challenge
              </button>
            )}
          </div>
        ) : (
          <ChallengeTable 
            challenges={filteredChallenges}
            onChallengeClick={handleChallengeClick}
          />
        )}
      </div>

      {/* Add Challenge Modal */}
      {showAddModal && (
        <AddChallengeModal
          onClose={() => setShowAddModal(false)}
          onChallengeAdded={handleChallengeAdded}
          showToast={showToast}
        />
      )}

      {/* Challenge Detail Modal */}
      {selectedChallenge && (
        <ChallengeDetailModal
          challenge={selectedChallenge}
          onClose={() => setSelectedChallenge(null)}
          onChallengeUpdated={handleChallengeUpdated}
          onChallengeDeleted={handleChallengeDeleted}
          showToast={showToast}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default ChallengeManagement;

