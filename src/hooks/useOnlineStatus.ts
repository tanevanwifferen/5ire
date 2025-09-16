import { useState, useEffect } from 'react';

/**
 * Custom React hook that tracks the browser's online/offline status.
 * 
 * @returns {boolean} True when the browser is online, false when offline
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isOnline = useOnlineStatus();
 *   
 *   return (
 *     <div>
 *       Status: {isOnline ? 'Online' : 'Offline'}
 *     </div>
 *   );
 * }
 * ```
 */
export default function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    /**
     * Event handler that sets the online status to true when the browser comes online.
     */
    function handleOnline() {
      setIsOnline(true);
    }
    /**
     * Event handler that sets the online status to false when the browser goes offline.
     */
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  return isOnline;
}
