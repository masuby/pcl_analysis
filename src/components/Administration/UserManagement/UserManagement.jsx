import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import SearchBar from './SearchBar/SearchBar';
import UserTable from './UserTable/UserTable';
import AddUserModal from './AddUserModal/AddUserModal';
import UserDetailModal from './UserDetailModal/UserDetailModal';
import Toast from '../../Common/Toast/Toast';
import LoadingSpinner from '../../Common/Loading/LoadingSpinner';
import './UserManagement.css';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [toast, setToast] = useState(null);

  // Fetch users from Firestore
  useEffect(() => {
    fetchUsers();
  }, []);

  // Filter users based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredUsers(users);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = users.filter(user => 
      user.email?.toLowerCase().includes(term) ||
      user.displayName?.toLowerCase().includes(term) ||
      user.role?.toLowerCase().includes(term) ||
      user.department?.toLowerCase().includes(term)
    );
    
    setFilteredUsers(filtered);
  }, [searchTerm, users]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const usersRef = collection(db, 'users');
      const q = query(usersRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const usersList = [];
      querySnapshot.forEach((doc) => {
        usersList.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setUsers(usersList);
      setFilteredUsers(usersList);
    } catch (error) {
      console.error('Error fetching users:', error);
      showToast('error', 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (term) => {
    setSearchTerm(term);
  };

  const handleAddUser = () => {
    setShowAddModal(true);
  };

  const handleUserAdded = (newUser) => {
    setUsers([newUser, ...users]);
    setFilteredUsers([newUser, ...filteredUsers]);
    showToast('success', 'User added successfully');
  };

  const handleUserUpdated = (updatedUser) => {
    const updatedUsers = users.map(user => 
      user.id === updatedUser.id ? updatedUser : user
    );
    setUsers(updatedUsers);
    setFilteredUsers(updatedUsers);
    showToast('success', 'User updated successfully');
  };

  const handleUserDeleted = (userId) => {
    const updatedUsers = users.filter(user => user.id !== userId);
    setUsers(updatedUsers);
    setFilteredUsers(updatedUsers);
    showToast('success', 'User deleted successfully');
  };

  const handleUserClick = (user) => {
    setSelectedUser(user);
  };

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  return (
    <div className="user-management">
      {/* Header with Search and Add Button */}
      <div className="user-management-header">
        <div className="header-left">
          <h2>User Management</h2>
          <p className="user-count">
            Total: <span className="count-number">{users.length}</span> users
            {searchTerm && (
              <span className="filtered-count">
                • Showing: <span className="count-number">{filteredUsers.length}</span> users
              </span>
            )}
          </p>
        </div>
        
        <div className="header-right">
          <SearchBar onSearch={handleSearch} />
          <button 
            className="add-user-button"
            onClick={handleAddUser}
            aria-label="Add new user"
          >
            <span className="button-icon">+</span>
            <span className="button-text">Add User</span>
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="user-table-container">
        {loading ? (
          <div className="loading-container">
            <LoadingSpinner size="large" />
            <p>Loading users...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👥</div>
            <h3>No users found</h3>
            <p>
              {searchTerm 
                ? 'No users match your search. Try a different term.'
                : 'No users in the system yet. Add your first user!'
              }
            </p>
            {!searchTerm && (
              <button 
                className="empty-action-button"
                onClick={handleAddUser}
              >
                Add First User
              </button>
            )}
          </div>
        ) : (
          <UserTable 
            users={filteredUsers}
            onUserClick={handleUserClick}
          />
        )}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <AddUserModal
          onClose={() => setShowAddModal(false)}
          onUserAdded={handleUserAdded}
          showToast={showToast}
        />
      )}

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onUserUpdated={handleUserUpdated}
          onUserDeleted={handleUserDeleted}
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

export default UserManagement;