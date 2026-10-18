import { describe, expect, it, jest } from "@jest/globals";
import nodemailer from "nodemailer";
import { SmtpEmailService } from "./SmtpEmailService.js";

jest.mock("nodemailer");

// jest.fn() with no arguments infers a `never`-returning mock under this repo's strict TS
// settings — passing a real implementation instead lets TS infer a usable signature, matching
// the pattern jest.spyOn(...).mockResolvedValueOnce(...) achieves elsewhere in this codebase for
// already-typed functions (fetch); nodemailer's mocked module has no such built-in typing.
function mockTransport(sendMailImpl: () => Promise<unknown>) {
  const sendMail = jest.fn(sendMailImpl);
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  return sendMail;
}

describe("SmtpEmailService", () => {
  it("sends through nodemailer with the configured from-address and message fields", async () => {
    const sendMail = mockTransport(async () => ({}));

    const service = new SmtpEmailService({ host: "smtp.example.com", port: 587, user: "u", password: "p", from: "GarnishTable <no-reply@garnishtable.local>" });
    await service.send({ to: "owner@example.com", subject: "Hello", html: "<p>hi</p>", text: "hi" });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587, secure: false, auth: { user: "u", pass: "p" } })
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: "GarnishTable <no-reply@garnishtable.local>",
      to: "owner@example.com",
      subject: "Hello",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  it("uses secure:true for port 465", async () => {
    mockTransport(async () => ({}));
    new SmtpEmailService({ host: "smtp.example.com", port: 465, from: "no-reply@garnishtable.local" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it("omits auth when no user/password is configured", async () => {
    mockTransport(async () => ({}));
    new SmtpEmailService({ host: "smtp.example.com", port: 587, from: "no-reply@garnishtable.local" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it("propagates a send failure rather than swallowing it", async () => {
    mockTransport(async () => {
      throw new Error("connection refused");
    });
    const service = new SmtpEmailService({ host: "smtp.example.com", port: 587, from: "no-reply@garnishtable.local" });

    await expect(
      service.send({ to: "owner@example.com", subject: "Hello", html: "<p>hi</p>", text: "hi" })
    ).rejects.toThrow("connection refused");
  });

  it("keeps the platform address with the tenant's display name when no verified address is given", async () => {
    const sendMail = mockTransport(async () => ({}));
    const service = new SmtpEmailService({ host: "smtp.example.com", port: 587, from: "GarnishTable <no-reply@garnishtable.local>" });
    await service.send({ to: "c@example.com", subject: "S", html: "h", text: "t", from: { name: "Northstar Kitchens" } });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: { name: "Northstar Kitchens", address: "no-reply@garnishtable.local" } })
    );
  });

  it("uses a verified tenant address and reply-to, and strips header-injection characters from the name", async () => {
    const sendMail = mockTransport(async () => ({}));
    const service = new SmtpEmailService({ host: "smtp.example.com", port: 587, from: "no-reply@garnishtable.local" });
    await service.send({
      to: "c@example.com",
      subject: "S",
      html: "h",
      text: "t",
      from: { name: 'Evil\r\nBcc: victim@example.com "<x>"', address: "orders@agency.example.com" },
      replyTo: "help@agency.example.com",
    });
    const call = (sendMail.mock.calls[0] as unknown[])[0] as { from: { name: string; address: string }; replyTo: string };
    expect(call.from.address).toBe("orders@agency.example.com");
    expect(call.from.name).not.toMatch(/[\r\n"<>]/);
    expect(call.from.name).toBe("Evil Bcc: victim@example.com x");
    expect(call.replyTo).toBe("help@agency.example.com");
  });
});
