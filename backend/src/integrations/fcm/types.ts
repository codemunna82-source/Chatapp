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
