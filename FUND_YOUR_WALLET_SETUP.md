# Fund Your Wallet task integration

This build adds **Tax/Tasks → Fund Your Wallet** as a daily demo task.

## Flow
1. User opens Tasks to Earn.
2. User selects Fund Your Wallet.
3. User enters at least £1,000.
4. User requests a 6-digit server-generated demo verification code.
5. The code is printed to the server/Render logs and expires after 5 minutes.
6. User enters the code.
7. Server validates the code and the minimum amount.
8. Demo wallet is credited and the £200 demo task reward is credited.
9. Completion is stored against the calendar day.
10. The task becomes available again at 00:00 in the configured `TASK_TIMEZONE` (default: Africa/Lagos).

## Mobile
Global overflow prevention and mobile layout rules were added to stop horizontal swinging on phones.

## Important
This is a simulation. No real payment is initiated. For production money movement, use a legitimate payment provider and server-side payment confirmation/webhooks.
