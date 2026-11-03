// backend/config/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT == 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendInviteEmail = async ({ to, name, inviteUrl, role }) => {
  if (!process.env.SMTP_USER || process.env.SMTP_USER.includes('your_email')) {
    console.log('----------------------------------------------------');
    console.log(`📧 INVITE EMAIL TO: ${to}`);
    console.log(`🔗 SHAREABLE ONBOARDING LINK: ${inviteUrl}`);
    console.log('----------------------------------------------------');
    return true;
  }

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f17; color: #f3f4f6; padding: 40px 20px; border-radius: 16px; max-width: 500px; margin: 0 auto; border: 1px solid #1f2937;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #00f2fe; font-size: 22px; font-weight: 700; margin: 0;">THE GRID ARENA</h1>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 4px;">Staff Onboarding Invitation</p>
      </div>
      <div style="background-color: #111827; padding: 24px; border-radius: 12px; border: 1px solid #1f2937;">
        <p style="margin-top: 0; font-size: 15px; color: #e5e7eb;">Hello <strong>${name}</strong>,</p>
        <p style="font-size: 14px; color: #9ca3af; line-height: 1.5;">You have been invited to join <strong>The Grid Arena</strong> platform as a <strong>${role.toUpperCase()}</strong>.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${inviteUrl}" style="background-color: #00f2fe; color: #0b0f17; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 14px; display: inline-block;">Complete Onboarding</a>
        </div>
        <p style="font-size: 11px; color: #6b7280; text-align: center; margin-bottom: 0;">This invitation link is single-use and expires in 48 hours.</p>
      </div>
    </div>
  `;

  return transporter.sendMail({
    from: process.env.EMAIL_FROM || '"The Grid Arena" <no-reply@gridarena.in>',
    to,
    subject: `Invitation to join The Grid Arena (${role})`,
    html: htmlContent,
  });
};

const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  if (!process.env.SMTP_USER || process.env.SMTP_USER.includes('your_email')) {
    console.log('----------------------------------------------------');
    console.log(`📧 PASSWORD RESET EMAIL TO: ${to}`);
    console.log(`🔗 SECURE RESET LINK: ${resetUrl}`);
    console.log('----------------------------------------------------');
    return true;
  }

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f17; color: #f3f4f6; padding: 40px 20px; border-radius: 16px; max-width: 500px; margin: 0 auto; border: 1px solid #1f2937;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #00f2fe; font-size: 22px; font-weight: 700; margin: 0;">THE GRID ARENA</h1>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 4px;">Password Recovery Request</p>
      </div>
      <div style="background-color: #111827; padding: 24px; border-radius: 12px; border: 1px solid #1f2937;">
        <p style="margin-top: 0; font-size: 15px; color: #e5e7eb;">Hello <strong>${name}</strong>,</p>
        <p style="font-size: 14px; color: #9ca3af; line-height: 1.5;">We received a request to reset your password for your The Grid Arena account.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #00f2fe; color: #0b0f17; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 14px; display: inline-block;">Reset Password</a>
        </div>
        <p style="font-size: 11px; color: #6b7280; text-align: center; margin-bottom: 0;">If you did not request this, please ignore this email. This link expires in 15 minutes.</p>
      </div>
    </div>
  `;

  return transporter.sendMail({
    from: process.env.EMAIL_FROM || '"The Grid Arena" <no-reply@gridarena.in>',
    to,
    subject: 'Password Reset Request - The Grid Arena',
    html: htmlContent,
  });
};

module.exports = { sendInviteEmail, sendPasswordResetEmail };