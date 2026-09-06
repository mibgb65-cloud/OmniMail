import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { TooltipLayer } from './shared/ui/tooltip/TooltipLayer'
import './app/styles/base.css'
import './app/styles/splash.css'
import './app/styles/app-error.css'
import './shared/ui/language/language.css'
import './shared/ui/tooltip/tooltip.css'
import './features/auth/styles/auth-landing.css'
import './features/auth/styles/setup.css'
import './features/mailbox/styles/mailbox.css'
import './features/messages/styles/message-list.css'
import './features/mailbox/styles/mailbox-header.css'
import './features/messages/styles/message-list-motion.css'
import './features/messages/styles/bulk-actions.css'
import './features/mailbox/styles/mailbox-switcher.css'
import './features/mailbox/styles/mailbox-switcher-responsive.css'
import './features/mailbox/styles/managed-mailbox-actions.css'
import './features/mailbox/styles/mailbox-switcher-feedback.css'
import './features/mailbox/styles/mailbox-address-option.css'
import './features/mailbox/styles/quick-mailbox.css'
import './features/messages/styles/message.css'
import './features/messages/styles/message-actions.css'
import './features/messages/styles/reply-attachments.css'
import './features/messages/styles/email-frame-transition.css'
import './features/messages/styles/message-scrollbar.css'
import './features/messages/styles/message-scroll-top.css'
import './features/messages/styles/message-translation.css'
import './features/messages/styles/message-retry.css'
import './shared/ui/dialogs/external-link-dialog.css'
import './features/messages/styles/attachment-preview.css'
import './features/mailbox/styles/mail-delete-dialog.css'
import './features/compose/styles/compose-dialog.css'
import './features/compose/styles/recipient-input.css'
import './features/compose/styles/compose-dialog-responsive.css'
import './features/drafts/styles/draft-inline-editor.css'
import './features/drafts/styles/draft-list.css'
import './app/styles/responsive.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      <TooltipLayer />
    </AppErrorBoundary>
  </StrictMode>,
)
