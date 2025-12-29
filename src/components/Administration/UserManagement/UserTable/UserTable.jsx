import React from 'react';
import './UserTable.css';

const UserTable = ({ users, onUserClick }) => {
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getRoleColor = (role) => {
    const colors = {
      admin: '#2a5298',
      CS: '#38a169',
      LBF: '#d69e2e',
      SME: '#805ad5',
      ALL: '#3182ce'
    };
    return colors[role] || '#666';
  };

  const getDepartmentColor = (department) => {
    const colors = {
      CS: '#38a169',
      LBF: '#d69e2e',
      SME: '#805ad5',
      ALL: '#3182ce'
    };
    return colors[department] || '#666';
  };

  return (
    <div className="user-table-wrapper">
      <div className="table-responsive">
        <table className="user-table">
          <thead>
            <tr>
              <th className="user-column">User</th>
              <th className="role-column">Role</th>
              <th className="department-column">Department</th>
              <th className="status-column">Status</th>
              <th className="created-column">Created</th>
              <th className="actions-column">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr 
                key={user.id} 
                className="user-row"
                onClick={() => onUserClick(user)}
                tabIndex={0}
                onKeyPress={(e) => e.key === 'Enter' && onUserClick(user)}
              >
                <td className="user-column">
                  <div className="user-info">
                    <div className="user-avatar">
                      {user.displayName ? 
                        user.displayName.charAt(0).toUpperCase() : 
                        user.email.charAt(0).toUpperCase()
                      }
                    </div>
                    <div className="user-details">
                      <div className="user-name">
                        {user.displayName || user.email.split('@')[0]}
                      </div>
                      <div className="user-email" title={user.email}>
                        {user.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="role-column">
                  <span 
                    className="role-badge"
                    style={{ backgroundColor: getRoleColor(user.role) }}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="department-column">
                  <span 
                    className="department-badge"
                    style={{ backgroundColor: getDepartmentColor(user.department) }}
                  >
                    {user.department}
                  </span>
                </td>
                <td className="status-column">
                  <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="created-column">
                  <span className="created-date">
                    {formatDate(user.createdAt)}
                  </span>
                </td>
                <td className="actions-column">
                  <button 
                    className="view-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUserClick(user);
                    }}
                    aria-label={`View details for ${user.email}`}
                  >
                    👁️ View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Table Footer */}
      <div className="table-footer">
        <div className="footer-info">
          Showing <strong>{users.length}</strong> of <strong>{users.length}</strong> users
        </div>
        <div className="table-legend">
          <span className="legend-item">
            <span className="legend-dot admin"></span> Admin
          </span>
          <span className="legend-item">
            <span className="legend-dot cs"></span> CS
          </span>
          <span className="legend-item">
            <span className="legend-dot lbf"></span> LBF
          </span>
          <span className="legend-item">
            <span className="legend-dot sme"></span> SME
          </span>
        </div>
      </div>
    </div>
  );
};

export default UserTable;