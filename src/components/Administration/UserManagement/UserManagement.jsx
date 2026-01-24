import React, { useState, useEffect } from 'react';
import { getAllUsers } from '../../../services/users';
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

  // Fetch users from Go API
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
      user.display_name?.toLowerCase().includes(term) ||
      user.role?.toLowerCase().includes(term) ||
      user.department?.toLowerCase().includes(term)
    );
    
    setFilteredUsers(filtered);
  }, [searchTerm, users]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const result = await getAllUsers();
      
      if (result.success) {
        // Map snake_case to camelCase for compatibility
        const usersList = (result.data || []).map(user => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName || user.display_name || '',
          role: user.role,
          department: user.department,
          isActive: user.isActive !== undefined ? user.isActive : user.is_active,
          createdAt: user.createdAt || user.created_at,
          updatedAt: user.updatedAt || user.updated_at,
        }));
        
        setUsers(usersList);
        setFilteredUsers(usersList);
      } else {
        showToast('error', result.error || 'Failed to load users');
      }
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
    const mappedUser = {
      id: newUser.id,
      email: newUser.email,
      displayName: newUser.displayName || newUser.display_name || '',
      role: newUser.role,
      department: newUser.department,
      isActive: newUser.isActive !== undefined ? newUser.isActive : newUser.is_active,
      createdAt: newUser.createdAt || newUser.created_at,
    };
    setUsers([mappedUser, ...users]);
    setFilteredUsers([mappedUser, ...filteredUsers]);
    showToast('success', 'User added successfully');
  };

  const handleUserUpdated = (updatedUser) => {
    const mappedUser = {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName || updatedUser.display_name || '',
      role: updatedUser.role,
      department: updatedUser.department,
      isActive: updatedUser.isActive !== undefined ? updatedUser.isActive : updatedUser.is_active,
      createdAt: updatedUser.createdAt || updatedUser.created_at,
      updatedAt: updatedUser.updatedAt || updatedUser.updated_at,
    };
    const updatedUsers = users.map(user => 
      user.id === mappedUser.id ? mappedUser : user
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
