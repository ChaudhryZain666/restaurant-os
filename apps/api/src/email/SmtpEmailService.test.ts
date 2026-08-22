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

    const service = new SmtpEmailService({ host: "smtp.example.com", port: 587, user: "u", password: "p", from: "Tablecloth <no-reply@tablecloth.local>" });
    await service.send({ to: "owner@example.com", subject: "Hello", html: "<p>hi</p>", text: "hi" });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587, secure: false, auth: { user: "u", pass: "p" } })
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: "Tablecloth <no-reply@tablecloth.local>",
      to: "owner@example.com",
      subject: "Hello",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  it("uses secure:true for port 465", async () => {
    mockTransport(async () => ({}));
    new SmtpEmailService({ host: "smtp.example.com", port: 465, from: "no-reply@tablecloth.local" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it("omits auth when no user/password is configured", async () => {
    mockTransport(async () => ({}));
    new SmtpEmailService({ host: "smtp.example.com", port: 587, from: "no-reply@tablecloth.local" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it("propagates a send failure rather than swallowing it", async () => {
    mockTransport(async () => {
      throw new Error("connection refused");
    });
    const service = new SmtpEmailService({ host: "smtp.example.com", port: 587, from: "no-reply@tablecloth.local" });

    await expect(
      service.send({ to: "owner@example.com", subject: "Hello", html: "<p>hi</p>", text: "hi" })
    ).rejects.toThrow("connection refused");
  });
});
