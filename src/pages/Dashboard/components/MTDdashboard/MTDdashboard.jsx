import MTDCS from './components/MTDCS/MTDCS';
import MTDLBF from './components/MTDLBF/MTDLBF';
import MTDSME from './components/MTDSME/MTDSME';
import './MTDdashboard.css';

const MTDdashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  // Determine which department to show
  // Priority: selectedDepartment > userData.department > 'CS' as default
  const department = selectedDepartment !== 'ALL' 
    ? selectedDepartment 
    : (userData?.department || 'CS');

  // Route to appropriate department component
  const renderDepartmentView = () => {
    switch (department.toUpperCase()) {
      case 'LBF':
        return <MTDLBF />;
      case 'CS':
        return <MTDCS />;
      case 'SME':
        return <MTDSME />;
      default:
        return <MTDCS />;
    }
  };

  return (
    <div className="dashboard-view">
      {renderDepartmentView()}
    </div>
  );
};

export default MTDdashboard;
