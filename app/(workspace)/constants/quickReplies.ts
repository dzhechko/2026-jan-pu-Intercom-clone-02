import type { QuickReply } from '../types'

/**
 * FR-14: Quick reply templates for operator workspace.
 * Alt+1..5 sends the corresponding reply to the current dialog.
 */
export const QUICK_REPLY_TEMPLATES: QuickReply[] = [
  {
    id: 'qr-1',
    label: 'Connect specialist',
    content: 'Спасибо за обращение! Подключаю специалиста.',
  },
  {
    id: 'qr-2',
    label: 'Request email',
    content: 'Могу я уточнить ваш email для связи?',
  },
  {
    id: 'qr-3',
    label: '24h follow-up',
    content: 'Мы изучим ваш запрос и вернёмся в течение 24 часов.',
  },
  {
    id: 'qr-4',
    label: 'Demo offer',
    content: 'Хотите назначить демо-встречу с нашей командой?',
  },
  {
    id: 'qr-5',
    label: 'Transfer to sales',
    content: 'Передаю ваш запрос в отдел продаж.',
  },
]
