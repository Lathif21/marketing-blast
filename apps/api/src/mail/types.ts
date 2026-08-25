// Batas antara "menyusun pesan" dan "mengirim pesan".
//
// Identitas pengirim dan tautan berhenti berlangganan disisipkan di sisi
// penyusun, sebelum sampai ke driver mana pun — bukan tanggung jawab driver
// dan bukan sesuatu yang bisa dilewati dengan mengganti driver
// (04-aturan-kepatuhan.md §1).

export interface OutboundMessage {
  to: string;
  subject: string;
  /** Isi pesan yang sudah lengkap: personalisasi, footer identitas, tautan berhenti. */
  textBody: string;
  htmlBody?: string;
  /** Token unik per penerima untuk tautan berhenti berlangganan. */
  unsubscribeToken: string;
  /** Kampanye asal, dipakai menautkan event bounce dan keluhan. */
  campaignId: string;
}

export interface SendResult {
  /** ID pesan dari penyedia. Driver dummy membuat ID lokal berawalan `dummy-`. */
  messageId: string;
  /** `false` bila pesan hanya dicatat dan tidak benar-benar keluar. */
  delivered: boolean;
}

export interface MailDriver {
  readonly name: string;
  /** `true` hanya untuk driver yang benar-benar mengirim ke internet. */
  readonly sendsRealEmail: boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}
