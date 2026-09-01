import MTDDepartment from './components/MTDDepartment/MTDDepartment';
import './MTDdashboard.css';

// Department code → the name shown in the view. Agribusiness is filed under the
// AGRI code its MTD workbooks and report records use.
const LABELS = { AGRI: 'Agribusiness' };

const MTDdashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  // Determine which department to show
  // Priority: selectedDepartment > userData.department > 'CS' as default
  const department = selectedDepartment !== 'ALL'
    ? selectedDepartment
    : (userData?.department || 'CS');

  const code = String(department || 'CS').toUpperCase();
  const known = ['CS', 'LBF', 'SME', 'AGRI'].includes(code) ? code : 'CS';

  return (
    <div className="dashboard-view">
      <MTDDepartment department={known} label={LABELS[known]} />
    </div>
  );
};

export default MTDdashboard;
