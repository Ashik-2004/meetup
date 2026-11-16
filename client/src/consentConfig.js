// Product owner approval is still required before this consent language/flow is treated as final.
export const consentPolicy = Object.freeze({
  statusLabel: 'Draft copy — pending owner approval',
  senderTitle: 'Before you send',
  senderDisclosure: 'Sending this request means you agree: if the recipient taps “Accept & reveal profiles”, each of you will see the profile fields the other has chosen to share and private chat will open.',
  senderOutcome: 'If the request is declined, cancelled, expires or is blocked, both identities stay hidden.',
  recipientDisclosure: 'Accepting this request will reveal the profile fields each person chose to share and open private chat.',
  recipientAction: 'Accept & reveal profiles',
  sentNotice: 'Request sent. Your identity stays hidden unless the recipient chooses “Accept & reveal profiles.”',
});
