// L5: emails are bilingual by default, Romanian first, English below.
// SEC1: sign-in emails state that EventDesk staff will never ask for a code, and that
// a code the user did not request means someone is probing their address.

export function signInEmail(input: { code: string; magicUrl: string; appUrl: string }) {
  const subject = 'Codul tău de autentificare EventDesk / Your EventDesk sign-in code';
  const text = [
    `Codul tău de autentificare este: ${input.code}`,
    `Este valabil 15 minute și poate fi folosit o singură dată.`,
    `Link cu un singur clic (valabil cât codul): ${input.magicUrl}`,
    ``,
    `Echipa EventDesk nu îți va cere niciodată codul. Dacă ai primit acest email fără să îl fi cerut, altcineva îți sondează adresa — nu îl împărtăși cu nimeni.`,
    ``,
    `--- English ---`,
    `Your sign-in code is: ${input.code}`,
    `It is valid for 15 minutes and single-use.`,
    `One-tap link (valid as long as the code): ${input.magicUrl}`,
    ``,
    `EventDesk staff will never ask you for the code. If you received this email without requesting it, someone is probing your address — do not share it.`,
  ].join('\n');
  return { subject, text };
}

export function invitationEmail(input: { occasionTitle: string; guestUrl: string }) {
  const subject = `Invitație: ${input.occasionTitle} / Invitation: ${input.occasionTitle}`;
  const text = [
    `Ai fost invitat(ă) la „${input.occasionTitle}”.`,
    `Răspunde aici (linkul tău personal, doar pentru gospodăria ta): ${input.guestUrl}`,
    ``,
    `--- English ---`,
    `You have been invited to "${input.occasionTitle}".`,
    `Respond here (your personal link, for your household only): ${input.guestUrl}`,
  ].join('\n');
  return { subject, text };
}

export function digestEmail(input: {
  occasionTitle: string;
  sections: { ro: string; en: string }[];
}) {
  const subject = `Rezumatul zilei pentru „${input.occasionTitle}” / Daily digest for "${input.occasionTitle}"`;
  const body = input.sections.map((s) => `${s.ro}\n${s.en}`).join('\n\n');
  return { subject, text: body };
}
