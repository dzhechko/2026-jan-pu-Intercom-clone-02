'use client'

import { useState, useRef, useEffect } from 'react'
import { PQLNotification } from '../hooks/useNotifications'

interface NotificationBellProps {
  notifications: PQLNotification[]
  unreadCount: number
  onMarkAsRead: (id: string) => void
  onSelectDialog: (dialogId: string) => void
}

/**
 * FR-11: Notification bell icon with unread badge + dropdown.
 * Shows recent PQL notifications with tier badge, contact info, and time-ago.
 */
export function NotificationBell({
  notifications,
  unreadCount,
  onMarkAsRead,
  onSelectDialog,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleNotificationClick = (notification: PQLNotification) => {
    if (!notification.read) {
      onMarkAsRead(notification.id)
    }
    onSelectDialog(notification.dialogId)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 text-gray-500 hover:text-gray-700 transition-colors rounded-md hover:bg-gray-100"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <p className="text-xs text-gray-500">{unreadCount} unread</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                No notifications yet
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    !notification.read ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <TierBadge tier={notification.metadata.tier} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {notification.title}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{notification.body}</p>
                      {notification.metadata.contactEmail && (
                        <p className="text-xs text-gray-400 truncate">
                          {notification.metadata.contactEmail}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatTimeAgo(notification.createdAt)}
                      </p>
                    </div>
                    {!notification.read && (
                      <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TierBadge({ tier }: { tier?: 'HOT' | 'WARM' | 'COLD' }) {
  const styles = {
    HOT: 'bg-red-100 text-red-700',
    WARM: 'bg-yellow-100 text-yellow-700',
    COLD: 'bg-blue-100 text-blue-700',
  }

  return (
    <span
      className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
        styles[tier ?? 'COLD']
      }`}
    >
      {tier ?? 'PQL'}
    </span>
  )
}

function BellIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  )
}

function formatTimeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}
