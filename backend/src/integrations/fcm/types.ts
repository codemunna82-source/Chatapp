export interface PushPayload {
  title: string;
  body: string;
  /**
   * Delivered alongside the notification so tapping it can open the right
   * screen. FCM requires every data value to be a string — numbers and
   * booleans are rejected by the v1 API, not coerced.
   */
  data?: Record<string, string>;
  /**
   * Groups notifications on the device. Android replaces a notification
   * that shares a tag, so using the conversation id means ten messages
   * from one customer collapse into one entry instead of ten.
   */
  collapseKey?: string;
  /** Android notification channel — must already exist on the device. */
  channelId?: string;
  /**
   * Where tapping a WEB notification should land.
   *
   * Ignored for the Android app, which routes on the data payload instead.
   * A browser has no such router: the notification is handled by a service
   * worker that may be the only thing running, so the destination has to
   * travel with the message.
   */
  link?: string;
  /**
   * Keeps a web notification on screen until it is dealt with.
   *
   * For a ringing call and nothing else. Everything else should behave
   * like a message notification and fade.
   */
  requireInteraction?: boolean;
  /**
   * Send with NO notification block, so Android hands the message to the
   * app instead of drawing it itself.
   *
   * For ringing calls and their cancellations, and nothing else. A
   * notification Android draws is a notification the app cannot put
   * buttons on — the system tray owns it, the app's JS never runs, and
   * Accept/Reject have nowhere to come from. Data-only is what lets the
   * app build a call notification with actions and a full-screen intent.
   *
   * The cost is real and worth naming: Android does not deliver data-only
   * messages to an app the user or the OEM has force-stopped, where a
   * notification block would still have shown. PendingCallSync is the
   * backstop — it asks the server for a ringing call whenever the app is
   * opened — so the call is late rather than lost.
   *
   * The webpush block is untouched: a browser has no such distinction and
   * still needs its notification drawn for it.
   */
  dataOnly?: boolean;
}

export interface SendResult {
  /** Tokens FCM reported as permanently gone, for the caller to prune. */
  invalidTokens: string[];
  successCount: number;
  failureCount: number;
}

export interface PushGateway {
  isConfigured(): boolean;
  send(tokens: string[], payload: PushPayload): Promise<SendResult>;
}
