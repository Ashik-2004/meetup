// Product owner approval is still required before this consent language/flow is treated as final.
export const consentPolicy = Object.freeze({
  statusLabel: 'Draft copy — pending owner approval',
  senderTitle: 'Before you send',
  senderDisclosure: 'Sending this request means you agree: if the recipient taps “Accept & reveal profiles”, both your names and the profile fields each of you selected to share will be shown to one another, and private chat will open.',
  senderOutcome: 'If the request is declined, cancelled, expires or is blocked, both identities stay hidden.',
  recipientDisclosure: 'Accepting this request reveals both attendees’ names and the profile fields each chose to share, and opens private chat.',
  recipientAction: 'Accept & reveal profiles',
  sentNotice: 'Request sent. Your identity stays hidden unless the recipient chooses “Accept & reveal profiles.”',
});
