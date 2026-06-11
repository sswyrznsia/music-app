# Discord Rich Presence setup

Pulse Shelf uses Discord Rich Presence through the local Discord Desktop app IPC/RPC connection.
It does not use bot tokens, OAuth client secrets, passwords, or Discord server messages.

1. Create an Application in Discord Developer Portal.
2. Copy the Application ID.
3. Create a `.env` file in the project root.
4. Add `DISCORD_CLIENT_ID=YOUR_COPIED_APPLICATION_ID` to `.env`.
5. Add `DISCORD_LARGE_IMAGE_KEY=pulse_shelf` to `.env`, or leave it unset to use `pulse_shelf`.
   If Discord generated a different asset key, copy the exact key shown in the asset list and use it instead.
6. In Discord Developer Portal > Rich Presence > Art Assets, upload the image you want on the Discord activity card with the asset key `pulse_shelf`, or set `DISCORD_LARGE_IMAGE_KEY` to the generated key.
   Discord Rich Presence uses an uploaded asset key, not a local image file path.
7. Run the Discord Desktop app.
8. In Discord Settings > Activity Privacy, enable showing current activity as a status message.
9. Fully quit and restart Pulse Shelf.

If Discord is closed when Pulse Shelf starts, the app keeps running and retries the local RPC connection every 30 seconds.
