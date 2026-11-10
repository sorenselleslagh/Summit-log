// Who should receive a push for one new message.
// Skips the sender, people who left, muted chats, and blocks in either direction.
function selectPushTargets(input) {
  var message = input && input.message || {};
  var members = input && input.members || [];
  var blocks = input && input.blocks || [];
  var subscriptions = input && input.subscriptions || [];
  var now = input && input.now ? input.now : Date.now();

  function blocked(a, b) {
    return blocks.some(function (row) {
      if (!row) return false;
      return (row.blocker_id === a && row.blocked_id === b) || (row.blocker_id === b && row.blocked_id === a);
    });
  }

  var recipients = {};
  members.forEach(function (member) {
    if (!member || !member.user_id) return;
    if (member.user_id === message.sender_id) return;
    if (member.left_at) return;
    if (member.muted_until && Date.parse(member.muted_until) > now) return;
    if (blocked(message.sender_id, member.user_id)) return;
    recipients[member.user_id] = true;
  });

  return subscriptions.filter(function (sub) {
    return sub && recipients[sub.user_id];
  });
}

var expiredStatus = { 404: true, 410: true };

function isExpiredPush(status) {
  return !!expiredStatus[status];
}

if (typeof module === 'object' && module.exports) {
  module.exports = { selectPushTargets: selectPushTargets, isExpiredPush: isExpiredPush };
}
