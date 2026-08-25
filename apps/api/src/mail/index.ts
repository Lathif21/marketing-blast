import { config } from "../config.js";
import { createDummyDriver } from "./dummy.js";
import { createSesDriver } from "./ses.js";
import type { MailDriver } from "./types.js";

let driver: MailDriver | undefined;

/** Satu driver per proses, dipilih dari MAIL_DRIVER. */
export function mailDriver(): MailDriver {
  if (!driver) {
    driver = config.mail.driver === "ses" ? createSesDriver() : createDummyDriver();
  }
  return driver;
}

export type { MailDriver, OutboundMessage, SendResult } from "./types.js";
