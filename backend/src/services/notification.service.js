const {Resend} = require("resend");
const {normalizeEmailAddresses} = require("./input-validation.service");

const {RESEND_API_KEY, MAIL_FROM} = process.env;

function getResend() {
  if (!RESEND_API_KEY || !MAIL_FROM) {
    return null;
  }
  return new Resend(RESEND_API_KEY);
}

async function sendTicketNotification({to, subject, html}) {
  const resend = getResend();

  if (!resend) {
    throw new Error("Resend no configurado. Revisa RESEND_API_KEY y MAIL_FROM en .env.");
  }

  const recipients = normalizeEmailAddresses(Array.isArray(to) ? to : [to], {field: "to", max: 100});
  if (!recipients.length) {
    return;
  }

  const {error} = await resend.emails.send({
    from: MAIL_FROM,
    to: recipients,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Error al enviar email con Resend: ${error.message}`);
  }
}

module.exports = {
  sendTicketNotification,
};
