import { useEffect, useState } from 'react';

export default function useCollapsibleSections(storageKey, defaults = {}) {
  const [collapsedSections, setCollapsedSections] = useState(defaults);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setCollapsedSections(defaults);
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setCollapsedSections({
          ...defaults,
          ...parsed,
        });
      }
    } catch (err) {
      console.warn('Failed to read collapsible section state', err);
      setCollapsedSections(defaults);
    }
  }, [defaults, storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(collapsedSections));
    } catch (err) {
      console.warn('Failed to persist collapsible section state', err);
    }
  }, [collapsedSections, storageKey]);

  const toggleSection = (sectionId) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const setSectionsState = (sectionIds, collapsed) => {
    setCollapsedSections((prev) => {
      const next = { ...prev };
      sectionIds.forEach((sectionId) => {
        next[sectionId] = collapsed;
      });
      return next;
    });
  };

  return {
    collapsedSections,
    setCollapsedSections,
    toggleSection,
    setSectionsState,
  };
}
