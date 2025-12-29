import { useState, useEffect } from 'react';

export const useDateFilter = (dates = []) => {
  const [filteredDates, setFilteredDates] = useState(dates);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Filter dates based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredDates(dates);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = dates.filter(date => {
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).toLowerCase();
      
      return formattedDate.includes(term) || date.includes(term);
    });
    
    setFilteredDates(filtered);
  }, [searchTerm, dates]);

  const handleSearch = (term) => {
    setSearchTerm(term);
  };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setSearchTerm('');
  };

  return {
    filteredDates,
    searchTerm,
    isOpen,
    handleSearch,
    toggleDropdown,
    closeDropdown
  };
};




