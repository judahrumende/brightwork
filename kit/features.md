# Feature inventory

Exhaustive list of what the product does, big and small. Sources: the 86 logged-in screens (`screens.md`), 9,953 English UI strings extracted from the i18n dictionaries in the JS bundles (`strings/i18n-en.json`), the API catalogue (`api.md`), CSS keyframes and the Ted agent config (`GET /api/companies/:id/ted/config`). Items marked (seen) were observed on screen; (api) seen in network traffic; (js) only found in bundles.

## Brightwork implementation checklist

- [x] Shared light and dark design tokens, Plus Jakarta Sans configuration and original Brightwork and Pip artwork.
- [x] Worker canvas sky, original still fallback, and support for system reduced motion and Reduce effects.
- [x] Buttons, status pills, segmented controls, keyboard menus, popovers, modals, sheets, toasts with Undo, and keyboard-hint tooltips.
- [x] Shared skeleton and empty-state components, demonstrated in the component gallery.
- [x] Verify the Foundation gallery's component interactions and run an accessibility audit in an offline Chrome build.
- [ ] Verify the normal Vite/Fastify runtime, Playwright suite and pixel-diff report.
- [ ] Sign-in and account preferences, including persisted appearance and wallpaper.
- [x] Account settings display the credit balance and recent transactions.
- [ ] Workbench shell, dock, dashboard and notifications.
- [x] Recent Pip activity, saved work and open review or question notifications with per-account read status.
- [x] Website draft history, bookmarks and restore as a new revision for review.
- [x] Day, week, month and year calendar views, hourly lanes and current-time indicator, task creation, keyboard navigation, and daily, weekly and monthly recurrence previews with time-zone handling.
- [x] Create and open workspace calendar events with start and end times, location, attendees and notes.
- [x] Published-page view totals and a UTC range chart with keyboard inspection.
- [x] Step-based Runs with pause, resume, question and approval gates, reports, and credit limits.
- [x] Pip can plan ordered Run steps from a goal within the Run credit limit.
- [x] Queue the exact approved website revision for Run publication.
- [x] Multi-page HTML drafts, revision snapshots and published page URLs.
- [x] Build canvas with website cards, panning and zoom.
- [x] Opt-in task execution at scheduled occurrences.
- [x] Approved outbound email queue and visible provider acceptance status.
- [x] Workspace receiving addresses, signed inbound webhook, and received-message list and reader.
- [x] Optional cited web search from Pip and saved-work title search across accessible workspaces.
- [ ] Agent runtime, Build, Library, Schedule, Inbox, Settings, Insights, Visitors and public pages.

## 1. Product concept

- Ted is an AI employee that builds and runs a small business: plans it, builds the website/app/store, gets it found on Google, does outreach by email and phone, posts on social, runs ads, answers messages, writes documents, makes images and videos, keeps a schedule and reports results. (seen)
- A "business" (company, called a *foundable* in code) is the top-level workspace. Users can own several (plan limit 1/3/10). Company switcher with "Start over with a new idea" and "Run a second business" (Pro). (seen)
- **Run:** Ted's autonomous business loop. A run session has big goals (each with a "met" criterion and status), a task list, questions for the owner, directions, a report ("The run so far … 4 things done", "What I made"). Runs can be paused. Power tiers Run Lite / Run (Pro) / Run Ultra (Max). Approval modes "Ask first" vs "On its own". Per-run credit limit (No limit / Custom). (seen, api)
- **Credits economy:** everything costs credits (decimal, 10 dp). Free: 10 welcome credits + 5 daily (30/month), first website free. Paid plans Basic $25/200 cr, Pro $50/500 or $100/1,000, Max $200/2,500, $400/5,000, $800/10,000 (USD/month), rollover on Pro+, promo first-month discounts, referral "Invite a friend, you both get 200 credits". (api `/api/billing/plans`, seen)

## 2. Global shell (seen)

- Frosted top bar: company switcher (logo, name, chevron), Home / Build pills, search (Cmd/Ctrl+K palette), mail (Inbox), calendar (Schedule), bell with red count badge (Notifications), gift (Earn credits), green "Text Ted", "Talk to us" (Intercom), avatar menu.
- Avatar menu: name, email, available credits, Upgrade, Settings, Language, Appearance (light / dark / system), wallpaper Plain / Clouds (profile `background:"clouds"`), Help submenu (Talk to us, Tutorial hub, Docs, Report a bug with a form "What you did, what you expected, and what happened instead."), Log out.
- Floating "Message Ted" pill always bottom right; opens the Ted chat popup (animated `popup-chat-in/out`, `popup-history-in/out`).
- Sky wallpaper with animated clouds (WebGL cloud renderer + paint worker), "Reduce effects" preference disables heavy effects; `prefers-reduced-motion` respected (47 media blocks).
- Presence heartbeat every ~60 s (`POST /api/me/presence`).
- Tutorial / product tour with targets: build-home, build-name, build-tools, composer, history, inbox-folders, inbox-title, schedule-new, schedule-title, schedule-views, text-ted (`/api/companies/:id/tours`).
- Toasts for decisions (`decision-toasts`), undo windows ("decided-undo-runs-out" animation), save bar for unsaved changes ("Unsaved changes", "Discard changes?").

## 3. Home (desktop metaphor) (seen)

- "Desktop" card: sky wallpaper, "Need help?" chip, live clock chip, Ted's animated cursor chip ("Waiting for you", "Ted") that moves around while working, floating app windows with traffic lights (Research browser, Library, Run summary, Documents) that open/close with `screenOpen/screenClose/screenFocus` animations.
- Dock: Research, Browser | Outreach, Social, Build, Ads, Messages | Documents, Image, Videos, Schedule | Library | Settings. Hover magnify; running-app dot; each opens a popover with "In Run" / "Not in Run" sections and per-app defaults:
  - Research: day-grouped history of research jobs; browser window replays Ted's searches (computer views).
  - Browser: empty state until Ted browses.
  - Outreach: business email address (name@foundable.app), phone number ("Get a phone number"), WhatsApp.
  - Social: Instagram, TikTok, X, Facebook, YouTube, Google Business (also LinkedIn, Pinterest, Threads in assets) with Connect.
  - Build: Build Ultra toggle, Website, Get found on Google, Blog, Store.
  - Ads: Meta/Google/LinkedIn ads connect; ad wallet ("Ad money", top-ups through Stripe, "Nothing runs until you say yes").
  - Messages: unified DMs/replies.
  - Documents: Tone (Warm, Direct, Playful, Expert), Voice (First person…), Length (Short…).
  - Image: "Logo first" toggle, Picture rules, Words in pictures, Colours.
  - Videos: Foundable Video, Higgsfield.
  - Schedule: Repeat (Only when I press Start, Daily, Weekly), Time zone.
  - Library: tiles Social, Outreach, Documents, Assets, Videos, Files with counts, Expand Library.
  - Settings: Approval, Credit limit, Power.
- Ted panel (right): status headline (Waiting on you…, Waiting for your approval…, Review a website change to keep Ted going, current goal), Pause, Suggested tasks (shuffle, add), tabs Activity / Made / Runs, "Ted asks you" question cards with Answer, "Needs your OK" review cards, live activity feed with spinners, ticks and narrative notes (SSE).
- Dashboard cards: Build (live site thumbnail + URL pill), Revenue (7D/30D/90D/12M, area chart, hover crosshair tooltip, empty "Your first sale will show here" + Set up payments), Visitors (Visits, Page views, Visiting now, Top country, 3D dotted globe), Insights (Social / Sales / Customers).
- Insights page: Analytics (Revenue chart + Revenue/Sales/Avg order/Customers tiles), Customers (empty: Start accepting payments), Social (Impressions, Views, Engagement, Likes, Comments, Shares, Posts; Channels empty state).
- Visitors page: range menu (Today, Yesterday, Last 24 hours, 7/14/30/90 days, This month), current visits live dot, globe, Location, Visits, Page views, Views per visit, Visit duration, Bounce rate, Visits chart, Source, Page, Device, Country breakdowns.

## 4. Build (seen)

- Split view: Ted chat (left) and canvas (right). Chat header: sidebar toggle, history, editable chat title with menu (Rename, Delete), Text Ted, new chat. Sidebar: Search chats, New chat, grouped by date, View all history; History modal with search.
- Chat transcript: collapsible step lines ("Searched the web", "Saved your plan", "Made your website"), Preview pill, bookmark, sources chip ("5 pages read yesterday"), message actions (undo/rewind, thumbs up/down with feedback "This was not helpful because…", copy, more), rating, queued messages, dictation (mic with bounce/listen animations), paste/zip/file attachments, predictive suggestion "Press Tab to accept", "Shift ↵ for a new line", Cmd/Ctrl+Enter to send.
- Composer + menu: Add photos & files, Connect apps (Gmail, Calendar, Slack…), GitHub.
- Canvas: infinite pan/zoom board of website cards (Live badge, Visit site, Edit menu), select/hand tools, References (moodboard images for builds), Tidy up ("Arrange websites neatly"), undo/redo, zoom %, hints per input type (cursor scroll/pinch, finger).
- Top right: Import (bring in an existing site by URL), Your work (search, Add to chat, deleted creations), Tools.
- Site editor: Back, site picker, undo/redo, page picker with search, Tools, Update/Publish, live iframe preview, bottom bar Select / Edit text / Swap photos, click-to-attach part ("Editing: click a part to attach it"), versions and bookmarks, revert with confirm, publish/unpublish, share sheet, "Viewing as" test user, live test mode.
- Tools panel: Payments (Stripe Connect, Test/Live, products, orders, refunds, offers), Database (Tables, Users, Signups chart, Add test user, RLS policies with SELECT/INSERT rules), Security (Scan, Secrets), GitHub (connect, repos, branches, sync, recovery), AI (Answers, Credits per day, daily limit, Calls with All/Failed/Refused, model picker GPT-6 Luna / GPT-6.1 Sol / others, picture quality, own OpenAI key), Emails (sent website emails, Send test, Free plan banner), Logs, Store (products, variants, stock, shipping, rates).
- Build runs with live phases, design pictures, active-runs polling every ~3 s, "Build Ultra" premium builder.

## 5. Inbox (js, api; panel not screenshotted)

- Business email address at foundable.app (change address with limits and scheduled switch), own-domain mail on paid plans, folders, threads, drafts written by Ted, sent, rewrite, reply, reactions, attachments, blocked senders, sender identity, social DMs and replies in one inbox, phone calls and texts, "Needs your OK" drafts.

## 6. Schedule (seen)

- Views Day / Week / Month / Year and All tasks list; prev/next/Today; time zone chip; now-line; weekend shading; empty card "No tasks yet".
- New task: Task / Event; "At a time" or "When something happens" (trigger options), title, instructions for Ted, start date/time, repeat rules (Never, daily, weekly, every N…), preview of next occurrences, time zone. New event: title, location/video link, start/end, invitees, notes. Meeting, digest and email schedules; skip, resume, discard; runs history.

## 7. Library (seen)

- Categories Social, Outreach, Documents, Assets, Videos, Files; search everything; Gallery / List toggle; document viewer sheet with outline, Copy text, Talk to Ted; workspace files with storage limit; file preview, remove.

## 8. Settings modal (seen)

- General (logo editor with versions, name, tagline, business time, currency, Delete business), Team (invite link, invite people, roles Owner/Admin/Member/View only, monthly credit spend by member and by Ted), Integrations (search apps, categories), Vault (encrypted logins for Ted), GitHub, Domains (buy, search endings, DNS records, nameservers, transfer, renew, connect existing, primary domain), Plans & credit usage (current plan, credits left, free daily credits, breakdown, plan cards and comparison, Manage billing via Stripe portal, receipts, activity), Earn credits (referral link, share to WhatsApp/X/Email/Telegram), Account (name, email, local time, language, Show predictions, Reduce effects), All domains, Notifications (signal alerts, quiet hours, email pop-ups, texts, email categories), Privacy & security (export data, delete business, delete account, legal links).

## 9. Other surfaces

- Notifications drawer: All / Needs your OK, Mark all read, items with Review buttons. (seen)
- Search palette: suggestions (Go to Build/Run/Schedule/Library), search across business, actions, "Ask Ted: <query>". (seen)
- Approval sheets: before/after (Now / After) previews of website changes with Deny / Approve; offer, refund and settings proposals. (seen, js)
- Text Ted: QR code to message Ted by SMS/iMessage; phone line. (seen)
- Talk to us: Intercom support conversation. (api)
- Onboarding: landing prompt box ("I have an idea", "I have a website", "Surprise me"), sign up, brief intake, first website design animation, paywall sheet. (seen, js)

## 10. Ted agent tools (api `ted/config`, 108 tools)

request_support, web_search, ask_questions, write_document, memory, company_memory_save, remember, history_search, history_read, history_exclude, history_correct, build, build_status, build_cancel, build_continue, look_at_website, read_page, workspace_read, workspace_write, workspace_edit, workspace_exec, create_file, edit_file, make_deck, read_guide, video_render, publish, site_control, app_logs, app_ai_usage, website_data, build_source, store_products, store_shipping, store_orders, google_shop, propose_google_listing, set_google_shop, describe_offer, foundable_status, scheduled_tasks, calendar_events, propose_settings, change_settings, read_mail, contacts, phone_calls, do_not_call, place_call, get_phone_number, text_files, save_mail_attachment, draft_post, publish_post, ask_owner, run_list, run_control, post_performance, social_inbox, draft_reply, send_reply, whatsapp, social_find, social_read, social_draft, social_execute, product_assets, draft_ad, find_ad_targets, ad_audiences, group_ads, draft_foundable_ad, draft_search_ad, draft_email, send_email, withdraw_email_draft, edit_email_draft, send_newsletter, find_businesses, social_posts, find_people, find_data, get_data, propose_offer, create_offer, configure_checkout, request_secrets, integration_find, integration_read, integration_draft, integration_execute, request_integration, request_git_sync, request_website_link, add_existing_site, propose_rename, make_logo, change_logo, propose_domains, domain_admin, business_email, connection_admin, github_files, manage_team, delete_business, change_business, propose_foundable, tool_search

Capabilities flags: buildCreate, buildImageReferences, buildCatalogReferences, automaticSetup, messageQueue, workspaceFiles, dictation, freeChat.

## 11. Keyboard shortcuts (js)

- Cmd/Ctrl+K: search palette. Cmd/Ctrl+Enter: send. Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Ctrl+Y: undo/redo in the editor. Shift+Enter: new line. Tab: accept prediction. Esc closes every overlay (66 handlers). Arrow keys, Home/End, PageUp/PageDown in lists and menus. Schedule: P or K previous, N or J next, T today, C new task (`data-tip-keys` tooltips show the key).

## 12. Animations and micro-interactions (css)

272 keyframes. Motion tokens: ease-out `cubic-bezier(.16,1,.3,1)`, hover .16s, menu .16s/.12s, enter .22s, sheet .32s/.26s, panel .52s. Names (module hash stripped):

accordion-down, accordion-up, activity-pixel, activity-rise, activity-shimmer, activityDrop, activityFold, activityRise, activitySink, app-card-in, appear, arrive, askIn, askOut, askingDot, bar-name-in, bar-name-out, being-made-out, bob, breathe, build-design-in, build-pulse, card-in, card-next, cardIn, cardMakesRoom, cardTakesRoom, cardWordsIn, caret, cell-in, chat-add-menu-in, chat-continue-in, chat-drop-in, cloudsRise, computerIn, connection-pill-in, copied-draw, copied-grow, decided-check-in, decided-letter-off, decided-undo-runs-out, deskTedHue, details-in, develop, dialog-fade-in, dialog-fade-out, dialog-move-in, dialog-move-out, dictation-bounce, dictation-dot, dictation-listen-in, dot, dotRing, drift, edgeTurn, enter, entry-in, entry-shake, exit, factLoading, fade, failure-badge-settle, failure-mark-rise, failure-orbit-break, failure-text-in, fill, filled, finaleIn, first-build-canvas-in, first-website-design-in, float, foldSwap, gift-wiggle, giftIn, gridIn, growthBob, ideaSettles, ideaTaken, insights-bar, insights-fade, insights-in, land, leave, line-draw, line-sheen, lineupPriceDrop, lineupPriceIn, listIn, lit, live-check-draw, live-check-in, live-rise, liveBreath, living-caustic, living-film-fill, living-film-head, living-film-mark, living-float, living-floor, living-halo, living-image, living-polish, living-reflection, living-spark, living-tile, living-type, madeFly, mini-draw, mini-land, mode-in-from-larger, mode-in-from-smaller, mode-out-larger, mode-out-smaller, noteStill, noteWord, noteWrite, noticeDrop, noticeIn, noticeOut, noticeOutUp, ok-turn-in, ok-turn-out, pageArrive, panel-in, paywallBob, paywallOut, paywallPopIn, paywallSkyIn, paywallTwinkle, peekUp, pick-card-open, pieceIn, pingIn, placeholder-pulse, placeholders-in, placeholders-out, planCard, planIn, planLeave, planStrip, planStripLeave, planTurn, plannedIn, popIn, popup-chat-in, popup-chat-out, popup-history-in, popup-history-out, preview-error-rise, profile-sheen, publish-dot-ping, pulse, quickLook, quickNoteIn, quickNoteOut, quote-reply-in, railDot, railLive, readLine, renew-shimmer, reply-opens, resultIn, reveal, revert-confirm-in, ring, ripple, rise, row-menu-in, row-menu-out, rowArrive, rowLeave, sample-in, saveBarIn, saveBarOut, scale, scale-up-center, screenClose, screenFocus, screenOpen, searchDim, searchEnter, searchExit, searchFrostClears, sendFade, sendPop, sendRowEnter, server-pill-drop, settings-push-in, sheen, shine, shot-waits, shown-part-out, sink, siteEdge, siteIn, siteSaved, siteSettle, sky-arrive, slideIn, spin, spinner-turn, stackEnter, stackLand, status-dot-pulse, stillSpin, store-panel-in, storeRise, streaming-markdown-arrival, stroke, success-badge-orbit-in, success-orbit-resolve, success-text-in, swell, swipe-out-down, swipe-out-right, swipe-out-up, tagSheen, ted-loading-breathe, ted-loading-leave, ted-loading-ted-leave, ted-notice-words-in, ted-poof, ted-scene-prop-arrival, ted-scene-z, ted-sheen, tedBob, textTedArrive, textTedBreathe, textTedCheck, thumbFade, tileIn, tip-fade, tip-in, tip-in-above, titleIn, tourRise, turn-revealed, tutorial-enter, tutorial-light-in, twinkle, typeIn, typingRing, unspin, vaultPageArrive, vaultShakeA, vaultShakeB, veilIn, veilOut, videoFilmOut, videoFrameIn, videoPlaceholderSheen, welcomeConfetti, widget-live, words-in

## 13. Input placeholders (js)

name@example.com; Search customers…; https://; {"key": "value"}; YYYY-MM-DD; YYYY-MM-DD HH:mm:ss or ISO string; HH:mm:ss; Describe the new photo…; Search any name; example.com or subdomain.example.com; Search a name, like sunroomstudio; @; ns1.example.com; What’s this email for?; What you did, what you expected, and what happened instead.; e.g. RESEND_API_KEY; Search your work…; yourdomain.com; you@yourdomain.com; One line about this business; feature/new-branch; yourbusiness.com; Always show the mug. No people. Keep it minimal.; Search apps; 50.00; USD; Find a branch…; name@example.com, …; Instructions for Ted; One person per line: a name, an email or both; Message Ted…; This was not helpful because…; Search history…; What should change?; In your own words (optional); Message…

## 14. Empty states (js, 232 strings)

- `account_no_account_existing`: I already have an account
- `account_no_account_line`: There’s no account for {{email}} yet.
- `account_no_account_start`: Start my business
- `account_no_account_title`: New to Foundable?
- `account_preview_no_logout`: This local preview has no signed-in session to log out of.
- `account_search_no_matches`: No matches for “{{query}}”
- `account_search_no_matches_in`: No matches in {{name}} for “{{query}}”
- `account_search_no_matches_status`: No matches
- `account_search_no_matches_yours`: No matches in your business for “{{query}}”
- `activity_log_post_no_longer_on`: No longer on {{network}}
- `activity_video_no_credits`: Not enough credits to make a video
- `build_copy_no_products`: The copy has no products yet; add them in Payments.
- `build_line_no_credits`: You have no credits left. See your plan in Settings to keep building.
- `build_no_bookmarks`: No bookmarks yet
- `build_no_bookmarks_line`: Bookmark a version to find it here.
- `build_no_pages_found`: No pages found
- `build_no_preview_line`: Its preview couldn’t be built.
- `build_no_preview_title`: This version has no preview
- `build_no_saved_version`: No saved version yet
- `build_no_social_image`: No social image set
- `build_no_title_set`: No title set
- `build_no_versions`: No saved versions yet.
- `build_no_websites_match`: No websites match “{{query}}”.
- `build_no_websites_yet`: No websites yet. Describe one to Ted and it will appear here.
- `build_nothing_to_redo`: Nothing to redo
- `build_nothing_to_tidy`: Nothing to tidy up yet. Tidy up arranges two or more cards.
- `build_nothing_to_undo`: Nothing to undo
- `build_refusal_no_saved`: There’s no saved version to publish yet.
- `build_rewind_no_parent`: There’s no earlier version to go back to.
- `build_version_no_preview`: This version has no preview.
- `chat_build_intro_empty`: Tell me what to build, like a website for your business, and I’ll make it here.
- `chat_credit_limit_empty`: Ted stopped here: you’re out of credits.
- `chat_dictation_no_sound`: No sound from your microphone.
- `chat_dictation_no_speech`: Didn’t catch that. Try again.
- `chat_empty_heading`: What can I do for you?
- `chat_empty_history_works`: No conversations yet. Your chats will appear here after you send a message.
- `chat_error_no_access`: You don’t have access to this conversation.
- `chat_home_intro_empty`: I set up {{business}}. Ask me here for anything, like a website, an email to a customer or a social post.
- `chat_intake_empty_one`: Not added: {{names}} is empty. If it lives in a cloud drive, download it first, then add it again.
- `chat_intake_empty_other`: Not added: {{names}} are empty. If they live in a cloud drive, download them first, then add them again.
- `chat_load_no_access`: You don’t have access to this conversation. Use New chat to start another conversation.
- `chat_no_chats_match`: No chats match “{{query}}”.
- `chat_no_conversations`: No conversations yet
- `chat_no_conversations_match`: No conversations match “{{query}}”
- `chat_no_conversations_yet`: No conversations yet.
- `chat_no_preview_excel`: There’s no preview for Excel spreadsheets yet. Download it to open it.
- `chat_no_preview_kind`: This kind of file can’t be previewed here. Download it to open it.
- `chat_no_preview_powerpoint`: There’s no preview for PowerPoint presentations yet. Download it to open it.
- `chat_no_preview_word`: There’s no preview for Word documents yet. Download it to open it.
- `chat_no_text_reply`: Ted finished without a text reply.
- `chat_post_no_account`: {{run}} has no {{network}} account to post to yet.
- `chat_post_no_caption`: No caption
- `chat_resend_no_earlier`: Cannot edit: no previous version to revert to
- `chat_site_nothing_visible`: Nothing on your pages looks different.
- `chat_video_no_credits`: There weren’t enough credits to make this video.
- `chat_welcome_idea_empty`: Give Ted something to work with, like “a doggy daycare”.
- `chat_welcome_website_empty`: {{site}} doesn’t have a website on it yet.
- `chat_zip_empty`: This ZIP holds no files.
- `domains_all_no_match`: No domains match “{{query}}”.
- `domains_connect_problem_empty`: Please enter a domain name
- `domains_dns_nothing_changed`: Nothing changed yet.
- `domains_move_no_targets`: No other businesses can take this domain.
- `domains_transfer_refused_no_code`: The registrar has no authorization code for this domain right now.
- `git_no_branches`: No branches found
- `git_no_connections`: No connections yet
- `git_no_connections_line`: Add one to start syncing your websites with GitHub.
- `git_no_installations`: No installations available
- `git_no_linked`: No linked websites
- `git_no_linked_line`: This connection isn’t linked to any websites.
- `git_refusal_nothing_saved`: Save a version of this website first, then connect it.
- `git_refused_no_page`: A website needs its index.html page.
- `git_sync_no_answer`: GitHub didn’t respond to the check.
- `git_sync_no_pull`: Changes made on GitHub don’t come back into Foundable yet.
- `git_toast_no_new_account`: GitHub didn’t list a new account for you. If an organization’s owner has to approve Foundable, add the connection again once it’s approved.
- `home_customers_empty_detail`: When someone buys from your business, their orders, spend and status build up here.
- `home_from_ted_empty`: What Ted makes for you will appear here.
- `home_next_moves_nothing_new`: No new tasks right now.
- `home_no_channels_yet`: No channels yet
- `home_no_customers_match`: No customers match.
- `home_no_customers_yet`: No customers yet
- `home_no_data_yet`: No data yet
- `home_no_posts_yet`: No posts yet
- `home_no_sales_yet`: No sales yet
- `home_no_visits_period`: No visits in this period.
- `home_nothing_published`: Nothing published yet
- `home_nothing_to_see`: Nothing to see yet
- `home_social_no_numbers`: No numbers from the networks yet; they arrive as the networks measure your posts.
- `inbox_call_no_answer`: Unanswered call
- `inbox_call_nothing_said`: Nothing was said on this call.
- `inbox_empty_archived`: Nothing archived yet
- `inbox_empty_archived_detail`: Archive mail from the inbox and it lands here.
- `inbox_empty_drafts_detail`: Drafts you’re working on land here.
- `inbox_empty_inbox`: Your inbox is empty
- `inbox_empty_nothing`: Nothing here yet
- `inbox_empty_sent_detail`: Mail you send lands here.
- `inbox_no_calls`: No calls yet
- `inbox_no_comments_yet`: No comments yet.
- `inbox_no_mailbox_at`: We couldn’t find a mailbox at {{address}}, so this email probably won’t arrive.
- `inbox_no_matches_in`: No matches in {{folder}}
- `inbox_no_message_selected`: No message selected
- `inbox_no_messages_yet`: No messages yet.
- `inbox_no_preview`: (No preview)
- `inbox_no_recall_copy`: Cancellation does not confirm recall. Check for later provider updates.
- `inbox_no_recipients`: No recipients
- `inbox_no_reply_needed`: No reply needed
- `inbox_no_subject`: (No subject)
- `inbox_no_text`: No text
- `inbox_out_revoke_no_operation`: Approval was revoked, but this submission has no operation ID yet. Recover the exact submission to check whether sending was prevented.
- `inbox_post_no_text`: This post has no text.
- `inbox_review_no_text`: This review has no written text.
- `inbox_social_empty_body`: Everyone he talks to lands here: DMs, comments and reviews across your connected accounts.
- `no_credits`: You have no credits left. See your plan in Settings to keep building.
- `run_ads_no_ad_account`: Meta didn’t share an ad account that can run ads. Reconnect and tick one, or fix it in Meta Ads Manager.
- `run_ads_no_ad_account_network`: {{network}} has no ad account that can run ads yet. Set one up in {{manager}}.
- `run_ads_no_ad_account_tiktok`: TikTok didn’t share an advertiser account that can run ads. Reconnect and allow one, or fix it in TikTok Ads Manager.
- `run_ads_no_board_make`: Pinterest lists no public board for your ads’ pins yet.
- `run_ads_no_identity_linkedin`: LinkedIn lists no Company Page you can run ads as. You need to be an admin of the Page, and it must be linked to this ad account in Campaign Manager.
- `run_ads_no_identity_make_tiktok`: TikTok lists no identity this advertiser account can run ads as yet.
- `run_ads_no_identity_pinterest`: Pinterest lists no public board for your ads’ pins. Make a public board on Pinterest.
- `run_ads_no_identity_tiktok`: TikTok lists no identity this advertiser account can run ads as. Add one in TikTok Ads Manager.
- `run_ads_no_page`: Meta didn’t share a Facebook Page. Reconnect and tick the Page your ads should run as.
- `run_answer_no`: No
- `run_asset_no_website`: No website yet. Once Ted builds one, he takes pictures of it for your posts.
- `run_files_empty`: Files you send Ted and files Ted makes show up here.
- `run_google_ads_no_ad_account`: Google didn’t share an ad account that can run ads. Reconnect and pick one, or fix it in Google Ads.
- `run_library_empty_files_body`: Documents and lists Ted writes for you appear here.
- `run_library_empty_posts_body`: Your drafts and posts will appear here.
- `run_library_no_matches`: No matches for “{{query}}”
- `run_native_no_media`: No photo or video attached
- `run_no_longer_on`: No longer on {{network}}
- `run_post_no_longer_on`: No longer on {{channel}} since {{when}}
- `run_post_no_longer_on_networks`: No longer on its networks
- `run_session_no_credits`: You’re out of credits. See your plan in Settings to start {{run}}.
- `run_social_ads_no_page`: Meta didn’t share a Facebook Page, so nothing was connected. Try again, choose “Edit previous settings” in Meta’s window and tick the Page your ads run as. No Page yet? Create one on Facebook first.
- `run_social_no_ad_account`: Meta didn’t share an ad account. Try again, choose “Edit previous settings” in Meta’s window and tick your ad account.
- `run_social_no_ad_account_network`: {{network}} found no ad account for this login. Set one up in {{manager}}, then connect {{connection}} again.
- `run_social_no_business_profile`: This Google account doesn’t have a Google Business Profile. Try again and choose the account your profile is on.
- `run_social_no_facebook_page`: Facebook didn’t connect a Page. Try again, choose “Edit previous settings” on Facebook and select your business Page. No Page yet? Create one on Facebook first.
- `run_social_no_youtube_channel`: This Google account doesn’t have a YouTube channel. Try again and choose the account your channel is on.
- `schedule_no_events`: No events yet.
- `schedule_no_result`: The request did not return a result.
- `schedule_no_runs_yet`: This task has not run yet.
- `schedule_no_scheduled_tasks`: No scheduled tasks
- `schedule_no_tasks_yet`: No tasks yet
- `schedule_no_tasks_yet_detail`: What you or Ted schedule shows up here.
- `schedule_no_upcoming`: This schedule has no upcoming runs.
- `schedule_route_reason_no_action`: nothing to do
- `schedule_skip_no_credits`: No credits left
- `schedule_skip_nothing_new`: Nothing new since the last check
- `settings_account_name_empty`: Full name can’t be empty.
- `settings_account_no_foundables`: You don’t own any businesses.
- `settings_account_no_refund`: The rest of this billing period isn’t refunded.
- `settings_assistants_no_money`: Ted can’t buy anything or give refunds from {{assistant}}.
- `settings_earn_no_credits`: No credits
- `settings_earn_no_friends`: No friends yet
- `settings_earn_no_friends_line`: When someone joins with your link, they show up here.
- `settings_integrations_nothing_matching`: Nothing matching “{{query}}”
- `settings_logo_history_empty`: Logos you choose or upload will appear here.
- `settings_no_foundable_body`: Create your first business to edit its details here.
- `settings_no_foundable_title`: No business yet
- `settings_paywall_no_thanks`: No thanks
- `settings_team_no_foundable`: No business yet
- `settings_team_no_link`: No {{noun}} link yet
- `settings_team_no_match`: No one matches “{{query}}”.
- `settings_vault_empty_line`: Your business’s logins are kept here, locked.
- `settings_vault_empty_title`: Your Vault is empty
- `settings_vault_history_empty`: Nothing here yet.
- `settings_vault_sign_out_no_password`: Ted’s computer signs out there. You can sign him in again any time.
- `shell_no_foundable_yet`: You do not have a business yet.
- `store_no_address`: No ship-from address yet.
- `store_no_products_line`: Add what you sell, with its price, stock and pictures.
- `store_no_products_title`: No products yet
- `store_no_zones_line`: Add a zone for the countries you ship to, with a flat rate.
- `store_no_zones_title`: No shipping yet
- `tools_ai_no_answer`: No answer
- `tools_ai_no_answer_line`: OpenAI didn’t answer
- `tools_ai_no_calls`: No calls yet
- `tools_ai_no_calls_line`: Calls appear when a visitor uses this website’s AI, in its preview or on its published site.
- `tools_ai_no_failed_calls`: No failed calls in the loaded results.
- `tools_ai_no_limit`: No limit
- `tools_ai_no_refused_calls`: No refused calls in the loaded results.
- `tools_ai_no_usage`: OpenAI sent no usage
- `tools_db_no_changes`: No changes to save.
- `tools_db_no_database`: No database yet
- `tools_db_no_database_line`: {{site}} doesn’t have a database.
- `tools_db_no_expression`: No expression
- `tools_db_no_filtered_results`: The filters applied have returned no results from this table
- `tools_db_no_policies`: No RLS policies found
- `tools_db_no_primary_key`: It has no primary key, so its rows can be added here but not changed.
- `tools_db_no_results`: No results.
- `tools_db_no_rows_accessible`: No rows accessible.
- `tools_db_no_tables`: No tables yet
- `tools_db_no_tables_line`: Tables appear as soon as your website saves information.
- `tools_db_no_users`: No users yet
- `tools_db_no_users_line`: People who sign up to your website appear here.
- `tools_db_no_users_line_add`: People who sign up to your website appear here. Add a test user to try it as someone else.
- `tools_db_no_users_match`: No users match “{{search}}”
- `tools_db_nothing_matches_table`: Nothing matches table “{{table}}”.
- `tools_db_nothing_realtime`: Nothing under realtime.
- `tools_db_nothing_storage`: Nothing under storage.
- `tools_db_nothing_tables`: Nothing under tables.
- `tools_db_rls_no_grant`: RLS is enabled, but no policies grant access.
- `tools_emails_refused_no_address`: Your account has no email address to send it to.
- `tools_logs_no_errors`: No errors
- `tools_logs_no_match`: Nothing matches your search.
- `tools_logs_no_match_newest`: Nothing matches your search in the newest entries.
- `tools_logs_no_matching`: No matching logs
- `tools_logs_no_more_matches`: No more matches in the next stretch. Show more searches further back.
- `tools_logs_no_server_logs`: No server logs yet
- `tools_logs_no_server_logs_line`: Requests and errors will appear here when your website uses server code.
- `tools_logs_nothing_failed`: Nothing failed {{range}}.
- `tools_logs_outcome_no_answer`: No answer
- `tools_logs_printed_nothing`: It printed nothing.
- `tools_no_website`: No website yet
- `tools_no_website_ai`: Build a website to see what its AI answers and spends here.
- `tools_no_website_backend`: Build a website to manage its data here.
- `tools_no_website_emails`: Build a website to see the emails it sends here.
- `tools_no_website_github`: Build a website to keep its code in GitHub.
- `tools_no_website_logs`: Build a website to see its server requests and errors here.
- `tools_no_website_security`: Build a website to scan it for leaked keys here.
- `tools_orders_no_address`: No address
- `tools_payments_no_adjustments`: No adjustments yet
- `tools_payments_no_products`: No products yet
- `tools_payments_no_statuses`: No statuses
- `tools_payments_no_transactions`: No transactions yet
- `tools_payments_no_transactions_match`: No transactions match the filter
- `tools_ref_no_match`: No examples match.
- `tools_refund_card_no_payments`: Payments aren’t ready on this business, so nothing can be refunded here.
- `tools_security_no_issues`: No issues
- `tools_security_no_issues_found`: No issues found
- `tools_security_no_version`: No version yet
- `tools_viewing_no_backend`: This website has no database yet, so there is no one to sign in as.

## 15. Tooltips and hints (js, 48 strings)

- `account_search_ask_ted_hint`: Send this question to Ted in your chat
- `build_blocked_hint`: Something in this browser may be blocking it.
- `build_edit_hint`: Ask Ted to edit your title, description & icon
- `build_editing_hint`: Editing: click a part to attach it
- `build_hint_cursor_pinch`: Click a website to open it · Drag to move around · Pinch to zoom
- `build_hint_cursor_scroll`: Click a website to open it · Drag to move around · Scroll to zoom
- `build_hint_finger`: Tap a website to open it · Drag to move around · Pinch to zoom
- `build_hint_hand_pinch`: Hand: drag to move around the canvas · Pinch to zoom
- `build_hint_hand_scroll`: Hand: drag to move around the canvas · Scroll to zoom
- `build_preview_blocked_hint`: To see it live, try another Wi-Fi, or your phone with Wi-Fi off.
- `build_private_window_hint`: If this keeps happening, try a private window or another browser.
- `build_sign_in_again_hint`: If it keeps asking, ask Ted to check how your website signs people in.
- `build_sign_in_offer_hint`: It stays on for this website until you choose “Signed out” in Viewing as.
- `build_tidy_up_tip`: Arrange websites neatly
- `chat_new_line_hint`: Shift ↵ for a new line
- `chat_previewing_hint`: Already showing in live preview
- `chat_resend_busy_hint`: Cannot revert while operation in progress (e.g., a chat request)
- `chat_text_ted_connected_hint`: You can message Ted here any time.
- `domains_custom_hint`: e.g., example.com or subdomain.example.com
- `domains_endings_hint_one`: {{count}} ending. Type one to check it first, like sunroomstudio.studio
- `domains_endings_hint_other`: {{count}} endings. Type one to check it first, like sunroomstudio.studio
- `domains_own_hint_taking_longer`: Taking longer than usual
- `domains_primary_hint`: Your site’s other addresses send visitors here
- `domains_primary_pending_hint`: This becomes your main website address when setup finishes.
- `domains_transfer_reveal_hint`: Transfer lock needs to be disabled to reveal.
- `git_branch_tip`: Choose the GitHub branch you want to sync with Foundable
- `inbox_sender_name_hint`: The name people see in their inbox.
- `phone_your_phones_hint`: When you call from your phone, Ted knows it’s you and does what you ask.
- `run_ad_target_places_hint`: {{network}} lets you add {{kinds}}.
- `run_hint_add_file`: Add it with +…
- `run_hint_link`: Paste the link…
- `run_hint_or_tell`: Or tell him…
- `run_hint_type`: Your answer…
- `settings_assistants_prompt_hint`: Paste the prompt into {{assistant}} and it walks you through adding Foundable.
- `settings_integrations_excel_hint`: Needs a Microsoft 365 work or school account, with workbooks in OneDrive or SharePoint.
- `settings_integrations_finish_connecting_hint`: Finish connecting your account, then check the connection.
- `settings_integrations_teams_hint`: Needs a Microsoft 365 work or school account with Teams.
- `settings_team_batch_hint`: Up to {{limit}} at a time, separated by commas or spaces.
- `store_field_countries_hint`: Two-letter codes, such as US, CA
- `store_stock_hint`: Leave stock empty to sell without counting it, so it never sells out.
- `tools_db_json_tip`: Tip: Use Ctrl+Enter to save, or click Format to prettify JSON
- `tools_db_rls_enabled_tip`: Row level security is enabled: only rows allowed by a policy are accessible.
- `tools_logs_download_hint`: Download logs as a JSON file
- `tools_preview_select_hint_click`: Select: click a part of your website to ask Ted about it
- `tools_preview_select_hint_tap`: Select: tap a part of your website to ask Ted about it
- `tools_preview_swap_hint_click`: Swap photo: click a photo on your website, then choose the new one
- `tools_preview_swap_hint_tap`: Swap photo: tap a photo on your website, then choose the new one
- `tools_ref_use_tip`: Prepare a new website in chat. Nothing starts until you press Send.

## 16. Feature map from UI strings

Every i18n key group (area_subgroup), its size and sample copy. The full dictionary is in `strings/i18n-en.json`; module-level literal strings are in `strings/ui-strings-by-module.txt`.

### account

- **account_entry** (73): Too many attempts. Wait a few minutes before trying again. | Too many attempts. Try again in {{count}} minute. | Too many attempts. Try again in {{count}} minutes.
- **account_bug** (40): Add | Adding screenshot | Back to your report
- **account_search** (37): Actions | Search for anything | Ask Ted
- **account_link** (20): Too many login attempts | Back to Foundable | Back to sign-in
- **account_failure** (17): Your account is being deleted. Log out to see when it’s done. | This account is no longer available. Log out to continue. | Logging in was canceled.
- **account_tour** (13): Want to go back to Home? Press here. | Welcome to Build | Your website is ready
- **account_tutorial** (8): {{count}} card | {{count}} cards | Dismiss tutorial
- **account_signed** (7): Logging out… | Logging you out… | Create a new account
- **account_no** (4): I already have an account | There’s no account for {{email}} yet. | Start my business
- **account_role** (4): Admin | Member | Owner
- **account_support** (4): Questions before you sign up? Email our team and we’ll get back to you. | Chat is unavailable right now. You can still reach our team by email. | Close support
- **account_background** (3): Background | Clouds | Plain
- **account_foundable** (3): Foundable account | Could not create your business. | That business is no longer available.
- **account_group** (3): Account | Help | Places
- **account_deleted** (2): Your account was deleted | Your account and your businesses are gone. Logging in again starts a new account.
- **account_deleting** (2): Your account is being deleted… | We’re finishing your account and login cleanup. This usually takes a few seconds. You can 
- **account_loading** (2): Loading… | Loading account…
- **account_other** (2): Start a new business | This business is on another account
- **account_retry** (2): Retry account | Retry sign-out
- **account_sample** (2): Sample account | Sample credits
- **account_sign** (2): Sign in | Sign in to view
- **account_who** (2): Only the owner or an admin | Only the owner
- **account_appearance** (1): Appearance
- **account_available** (1): Available credits
- **account_callback** (1): We couldn’t log you in
- **account_contact** (1): Talk to us
- **account_create** (1): Create account
- **account_dark** (1): Dark
- **account_docs** (1): Docs
- **account_foundables** (1): Could not load your businesses.
- **account_language** (1): Language
- **account_light** (1): Light
- **account_log** (1): Log out
- **account_logged** (1): Logged in as {{email}}.
- **account_new** (1): New reply from the Foundable team
- **account_not** (1): This ad account isn't part of the {connection} connection, so nothing was created. Reconne
- **account_off** (1): An account it was going to was turned off before it went out, so it was not sent.
- **account_open** (1): {{name}}, open profile settings
- **account_preview** (1): This local preview has no signed-in session to log out of.
- **account_region** (1): Not available in your region
- **account_report** (1): Report a bug
- **account_return** (1): Return to Foundable
- **account_settings** (1): Settings
- **account_signing** (1): Signing out…
- **account_system** (1): System
- **account_unavailable** (1): Unavailable
- **account_unusable** (1): {network} won't let this ad account run ads right now, so nothing was created and nothing 
- **account_upgrade** (1): Upgrade
- **account_usage** (1): View usage & billing
- **account_your** (1): Your account

### activity

- **activity_log** (98): Your website was already live | Didn’t publish a bigger change | it waits for approval
- **activity_site** (51): Changing your website’s address | Changed your website’s address | Website address change
- **activity_measure** (36): {{number}} bookmark | {{number}} bookmarks | {{number}} click
- **activity_data** (34): Working on your website’s data | Worked on your website’s data | Data work
- **activity_propose** (30): Writing your plan | Wrote your plan | Plan proposal
- **activity_build** (29): Working on your website | Worked on your website | Couldn’t work on your website
- **activity_background** (24): Giving Run your answer | Gave Run your answer | Answer for Run
- **activity_status** (22): Checking your domains | Checked your domains | Checking your emails
- **activity_request** (21): Asking to connect GitHub | Asked to connect GitHub | GitHub request
- **activity_social** (18): Drafting a change in your social accounts | Drafted a change in your social accounts | Social accounts draft
- **activity_task** (18): Setting up a task | Set up a task | Task setup
- **activity_guide** (17): Where customers gather | Choosing a direction | Customer interviews
- **activity_file** (15): Working on a file | Worked on a file | File work
- **activity_find** (15): Finding ad audiences | Found ad audiences | Audience search
- **activity_memory** (15): Working on memory | Worked on memory | Memory work
- **activity_read** (15): Changes | Changes · {{file}} | continued
- **activity_setting** (15): Your name | Your time zone | Appearance
- **activity_post** (14): Post wasn’t changed | Couldn’t confirm the change | Moved a post
- **activity_website** (14): Working in a connected website | Worked in a connected website | Website action
- **activity_video** (13): Creating a video | Created a video | Not covered by your free video uses
- **activity_draft** (12): Drafting an email | Worked on an email draft | Email draft
- **activity_history** (12): Linking your correction | Linked your correction | Correction
- **activity_integration** (12): Drafting a change in a connected app | Drafted a change in a connected app | App draft
- **activity_app** (11): Checking your website’s AI use | Checked your website’s AI use | AI use check
- **activity_email** (11): Email send was cancelled | Email goes out later | Email wasn’t sent
- **activity_logo** (11): Logo was already up to date | Changing your logo | Changed your logo
- **activity_github** (10): Connected GitHub | Reading your GitHub files | Read your GitHub files
- **activity_team** (10): Updated team access | Updating your team | Updated your team
- **activity_change** (9): Switching your business | Switched your business | Business switch
- **activity_edit** (9): Changing an email draft | Changed an email draft | Email draft change
- **activity_knowledge** (9): Updating knowledge settings | Updated knowledge settings | Knowledge setting
- **activity_make** (9): Making a deck | Made a deck | Deck
- **activity_send** (9): Sending an email | Worked on sending an email | Email send
- **activity_take** (9): Post cancelled | Took back a post draft | Taking a post down
- **activity_computer** (8): Checking the computer’s sign-ins | Checked the computer’s sign-ins | Computer sign-ins
- **activity_domain** (7): Updating your domain | Worked on your domain | Domain change
- **activity_research** (7): Researching a good fit | Researched a good fit | Research
- **activity_settings** (7): Settings were already up to date | Changed your settings | Settings changed meanwhile
- **activity_ask** (6): Asking you something | Asked you | Question
- **activity_assets** (6): Capturing your website | Captured your website | Website capture
- **activity_connections** (6): Updating connections | Updated connections | Connection change
- **activity_create** (6): Making a file | Made a file | File
- **activity_foundable** (6): Reading Foundable’s help | Read Foundable’s help | Foundable help read
- **activity_get** (6): Looking up data | Looked up data | Data lookup
- **activity_offer** (6): Preparing choices | Prepared choices | Choices
- **activity_plan** (6): Planning AI features | Planned AI features | AI feature plan
- **activity_publish** (6): Publishing your site | Worked on publishing your site | Publish
- **activity_save** (6): Saving an email attachment | Saved an email attachment | Attachment save
- **activity_sign** (6): Updating your website’s sign-in emails | Updated your website’s sign-in emails | Sign-in emails change
- **activity_sources** (6): Also read | {{count}} source | {{count}} sources
- **activity_suggest** (6): Thinking of ideas | Suggested ideas | Ideas
- **activity_attached** (5): Watching your video | Watched your video | Watching
- **activity_tasks** (5): Changing your scheduled tasks | Changed your scheduled tasks | Checking your scheduled tasks
- **activity_refused** (4): Couldn’t edit a file | Couldn’t find a file | Couldn’t read a file
- **activity_unfinished** (4): {{noun}} failed | {{noun}} interrupted | {{noun}} stopped
- **activity_web** (4): Searching the web | Searched the web | Search
- **activity_ad** (3): Checking the ad audiences | Checked the ad audiences | Audience check
- **activity_add** (3): Adding your existing site | Added your existing site | Existing site
- **activity_answer** (3): Applying your answer | Applied your answer | Your answer
- **activity_calendar** (3): Updating your calendar | Updated your calendar | Calendar update
- **activity_complete** (3): Saving your plan | Saved your plan | Plan save
- **activity_connection** (3): Connection needs sign-in | Connection wasn’t changed | Couldn’t confirm the connection change
- **activity_contacts** (3): Checking your contacts | Checked your contacts | Contacts
- **activity_correct** (3): Correcting your plan | Corrected your plan | Plan correction
- **activity_delegate** (3): Looking into it | Looked into it | Research
- **activity_delete** (3): Preparing to delete this business | Deletion is being checked | Business deletion
- **activity_do** (3): Updating the do-not-call list | Updated the do-not-call list | Do-not-call list
- **activity_domains** (3): Checking domains | Checked domains | Domain check
- **activity_end** (3): Hanging up | Hung up | Hang-up
- **activity_enlarge** (3): Making pictures larger | Made pictures larger | Larger pictures
- **activity_forget** (3): Forgetting | Forgot | Forgetting
- **activity_google** (3): Working on your Google shop | Worked on your Google shop | Google shop
- **activity_inbox** (3): Comments | Messages | Reviews
- **activity_invite** (3): Prepared an invite link | Invitation saved; email not sent | Invitation saved; email unconfirmed
- **activity_keep** (3): Keeping a reference picture | Worked on keeping a reference picture | Reference picture
- **activity_logos** (3): Checking saved logos | Checked saved logos | Logo check
- **activity_look** (3): Looking at the website | Looked at the website | Website look
- **activity_move** (3): Moving your texts | Moved your texts | Text move
- **activity_note** (3): Taking a note | Noted | Note
- **activity_phone** (3): Reading your calls | Read your calls | Calls read
- **activity_place** (3): Calling | Called | Call
- **activity_posts** (3): Working on a post | Worked on a post | Post step
- **activity_present** (3): Exploring business ideas | Prepared business ideas | Business ideas
- **activity_recording** (3): Listening to your recording | Listened to your recording | Listening
- **activity_redeem** (3): Redeeming your promo code | Redeemed your promo code | Promo code redemption
- **activity_remember** (3): Remembering | Remembered | Remembering
- **activity_resend** (3): Sending a sale to your website | Sent a sale to your website | Sale notice
- **activity_store** (3): Working on the store | Worked on the store | Store
- **activity_tell** (3): Writing you an update | Wrote you an update | Update
- **activity_text** (3): Texting files to your phone | Texted files to your phone | Text of files
- **activity_transfer** (3): Putting the call through | Put the call through | Call transfer
- **activity_use** (3): Using the computer | Used the computer | Computer work
- **activity_watch** (3): Watching a video | Watched a video | Video watch
- **activity_whatsapp** (3): Working on WhatsApp | Worked on WhatsApp | WhatsApp
- **activity_withdraw** (3): Taking back an email draft | Took back an email draft | Email withdrawal
- **activity_write** (3): Writing a document | Wrote a document | Document
- **activity_asked** (2): Asked you {{count}} question | Asked you {{count}} questions
- **activity_recordings** (2): Listening to your recordings | Listened to your recordings
- **activity_tool** (2): Used {{tool}} | Using {{tool}}
- **activity_deletion** (1): Deletion wasn’t prepared
- **activity_from** (1): from line {{line}}
- **activity_page** (1): page {{page}}
- **activity_promo** (1): Promo code not redeemed
- **activity_support** (1): Support draft prepared

### admin

- **admin_only** (1): Only the owner or an admin of this business can do this.

### agent

- **agent_failed** (1): Build stopped before it finished. Nothing was saved.
- **agent_limit** (1): Build stopped at its limit for one request. Nothing was saved.

### ai

- **ai_videos** (1): AI videos

### already

- **already_set** (1): It is already set to that.

### api

- **api_host** (1): https://us.i.posthog.com

### attachment

- **attachment_unavailable** (1): A file attached to the message is unavailable. Attach it again and send a new request.

### audience

- **audience_account** (2): This ad account isn't part of the {connection} connection, so nothing was made. Reconnect  | {network} won't let this ad account run ads right now, so nothing was made. Fix it in {man
- **audience_refused** (2): Meta refused this audience, so nothing was made. Check the Page in Meta Ads Manager and tr | {network} refused this audience: {reason}. Nothing was made.
- **audience_connection** (1): The {connection} connection needs reconnecting, so nothing was made. Reconnect it in Run's
- **audience_gone** (1): Meta no longer has this audience, so ads cannot name it.
- **audience_interrupted** (1): Making this audience was interrupted before Meta answered. It is held and never made again
- **audience_uncertain** (1): Meta did not confirm this audience. It is held and never made again: check Ads Manager bef

### backend

- **backend_cannot** (1): This feature needs the website's database, which cannot be set up right now. The website i
- **backend_needs** (1): This feature needs the website's database to be ready. The website is unchanged and the fe
- **backend_not** (1): Foundable has not finished getting this feature ready. The website is unchanged.
- **backend_unavailable** (1): Foundable could not finish setting up this feature. The website is unchanged.

### below

- **below_quality** (1): run_asset_capture_below_quality

### billing

- **billing_ads** (34): Add {{amount}} | Add money | Add more
- **billing_ad** (1): Adding money…

### build

- **build_line** (56): Build stopped before it finished. Nothing was saved. | Build stopped at its limit for one request. Nothing was saved. | A file attached to the message is unavailable. Attach it again and send a new request.
- **build_text** (30): Text changes | {{count}} text change | {{count}} text changes
- **build_notice** (22): The visitor analytics setting could not be saved. Try again. | The badge setting could not be saved. Try again. | This version can’t be published.
- **build_part** (22): Button | Caption | Cell
- **build_share** (18): Share | Share on Discord | Share it to get your first visitors.
- **build_preview** (17): Your preview will appear after a version is saved. | To see it live, try another Wi-Fi, or your phone with Wi-Fi off. | Your website is saved. Here’s a picture of it.
- **build_refusal** (16): Something went wrong getting your website ready. Ted is setting it up again. | Your website is still getting ready, so Ted couldn’t publish it yet. | This version has build errors. Fix them, then ask again.
- **build_page** (13): Page | Social and search details for {{path}} | Foundable checks pages without your website’s keys, and this one may need them. If it open
- **build_publish** (12): Publish | Publishing starts as soon as the build finishes, usually within a minute. You can close th | Publishing starts as soon as it’s ready, usually within a minute. You can close this dialo
- **build_version** (12): Version actions | Version actions: {{title}} | This saved version cannot be published. Choose a supported saved version.
- **build_no** (11): No bookmarks yet | Bookmark a version to find it here. | No pages found
- **build_live** (10): Preview paused while Ted builds. It will reload when ready. | Live preview frame loaded | Live preview lost connection.
- **build_sign** (10): Sign in again | If it keeps asking, ask Ted to check how your website signs people in. | Your website asked you to sign in again.
- **build_rewind** (9): Failed to revert to message | Newer changes were saved, so this can’t be undone. | There’s no earlier version to go back to.
- **build_sample** (9): Book an appointment | Thoughtful dental care, designed around you. | Personal care. Modern comfort.
- **build_website** (9): Website actions | Website actions: {{name}} | Website canvas
- **build_primary** (8): Built in Foundable | Built in Foundable · Live | Your external site
- **build_change** (7): Denied | Getting it ready to go live | Replaced by a newer version
- **build_import** (7): Import | Importing another site replaces this one. | Couldn’t import the site. Try again.
- **build_loading** (7): Loading more versions… | Loading the newer saved version… | Loading the newer version…
- **build_publishing** (7): Publishing… | Publishing paused | Publishing paused. Retry to continue the same release.
- **build_zoom** (7): Already at maximum zoom | Already at minimum zoom | Zoom in
- **build_address** (6): This address couldn’t be changed. Try again. | You don’t have permission to change this address. | Too many changes just now. Try again in a minute.
- **build_open** (6): Open the current version before publishing. | Open current version | Open full screen
- **build_phase** (6): Building your website | Checking the website | Getting started
- **build_request** (6): Make a new photo for this spot: | About this security issue in my website: {{finding}}. | Replace this photo with the one I attached.
- **build_revert** (6): Revert | Another change to this website is still saving. Try again in a moment. | Cannot revert to the current version
- **build_show** (6): Show history | Show in chat | Show logs
- **build_undo** (6): Undo | The version before this change doesn’t build now, so it can’t go live again here. Open it  | The version before this change is still building. Try again in a moment.
- **build_approve** (5): Approve | This change doesn’t build, so it can’t go live. Deny it to put your website back. | This change is still building. Approve it again in a moment.
- **build_hint** (5): Click a website to open it · Drag to move around · Pinch to zoom | Click a website to open it · Drag to move around · Scroll to zoom | Tap a website to open it · Drag to move around · Pinch to zoom
- **build_server** (5): Server couldn’t be built. | Server ready. Reloading… | Still starting your server…
- **build_sort** (5): Sort by | Default order | Name
- **build_unpublish** (5): Unpublish | Your published site will go offline and the URL won’t work anymore. You can republish anyt | The publishing state changed before removal. Choose Unpublish again to remove the current 
- **build_back** (4): Back to “{{title}}” | Back to latest | Back to preview
- **build_building** (4): Building… | Building your preview… | Building preview…
- **build_copy** (4): Copy link | {{name}} copy | The copy has no products yet; add them in Payments.
- **build_database** (4): Your website’s database couldn’t be set up. Ask Ted to set it up again. | Database couldn’t be set up. | Setting up your database…
- **build_edit** (4): Ask Ted to edit your title, description & icon | Edit icon and details | Edit {{title}}
- **build_published** (4): Published | The published version changed elsewhere. Review its current status before trying again. | The published version changed, but its current status could not be loaded yet.
- **build_site** (4): The website encountered an error | Your website is live | Your website is moving to <strong>{{hostname}}</strong>. Your next change finishes the mov
- **build_standing** (4): Saved, not live yet | Live | Not live yet
- **build_update** (4): Update | They won’t be visible to visitors until you publish an update. | You’ve made changes to your website
- **build_bookmark** (3): Bookmark in history | Couldn’t save the bookmark. Try again. | Remove bookmark
- **build_delete** (3): Its live site goes offline. | “{{name}}” leaves {{build}}. | Delete website?
- **build_deny** (3): Deny | This change is live or publishing, so it can’t be denied here. Revert it from History in { | Couldn’t deny this. Try again.
- **build_device** (3): Desktop preview | Mobile preview | Tablet preview
- **build_go** (3): Go to | Go to message in chat | Go to {{path}}
- **build_hide** (3): Hide Foundable badge | Hide history | Hide the other pages
- **build_list** (3): Couldn’t load your work. | Couldn’t load your work. Trying again… | More of your work could not be loaded. Try again.
- **build_more** (3): More actions | More ways to share | More websites
- **build_nothing** (3): Nothing to redo | Nothing to tidy up yet. Tidy up arranges two or more cards. | Nothing to undo
- **build_pace** (3): than usual | Taking longer | Usually 3–5 min
- **build_place** (3): Next | Now | Then
- **build_remove** (3): Ted stops reading {{host}} for your business. The site itself stays online. | Couldn’t remove the site. Try again. | Remove your external site?
- **build_search** (3): Search | Search your work | Search your work…
- **build_social** (3): Social | Social image couldn’t load | Social & search appearance
- **build_status** (3): Publishing status could not be loaded. Trying again… | Status unavailable | The latest publishing status could not be loaded. Trying again…
- **build_ted** (3): Ted is building your website | Ted is building the website for {{name}} | Ted is publishing your website…
- **build_ultra** (3): Build Ultra | Ted’s most powerful builder, for {{run}}’s website work | Ted builds your websites with his most powerful builder. Uses more credits.
- **build_add** (2): Add | Add to chat
- **build_ask** (2): Ask Ted | Ask Ted to edit
- **build_card** (2): Preview unavailable · Open to see it | Preview unavailable · Edit to see it
- **build_close** (2): Close history | Close your work
- **build_dismiss** (2): Dismiss | Dismiss error
- **build_download** (2): Download code | A ZIP of this website’s code.
- **build_editing** (2): Editing: click a part to attach it | Editing preview
- **build_existing** (2): Ted reads this site to run your business. Ask Ted to change it and he can bring it into Bu | Your external site
- **build_fix** (2): Fix error | Ted is sending a message right now. You can send a fix once he’s done.
- **build_hero** (2): This lets visitors view what you’ve built. They never see the changes you make until you p | Ready to put your site live?
- **build_history** (2): History | History view
- **build_load** (2): Couldn’t load more. Try again | Load more versions
- **build_move** (2): Move earlier or later | We couldn’t confirm the new address. Save again to retry it safely.
- **build_opening** (2): Opening your saved result… | Opening tools…
- **build_other** (2): Other pages of {{title}} | This request started in another browser session. Return there to resume it if it remains p
- **build_pages** (2): Pages | pages
- **build_progress** (2): Build progress | {{stage}}, {{percent}} percent
- **build_refresh** (2): Couldn’t refresh preview | Refresh preview
- **build_rename** (2): Rename | Rename website
- **build_replace** (2): Replace live site | Replace site
- **build_replaces** (2): This replaces the live site <strong>{{names}}</strong>. | This replaces the live sites <strong>{{names}}</strong>.
- **build_retry** (2): Retry publishing | Retry unpublish
- **build_saved** (2): Saved preview | Saved version
- **build_still** (2): Still loading preview… | Still publishing. Open the website in {{build}} to see when it’s live.
- **build_tab** (2): This preview could not be opened in a new tab. Try again. | The preview couldn’t open in a new tab.
- **build_tidy** (2): Tidy up | Arrange websites neatly
- **build_updating** (2): Updating… | Updating
- **build_view** (2): You have view-only access, so you can’t publish this website. | You have view-only access, so you can’t unpublish this website.
- **build_visit** (2): Visit {{title}} | Visit site
- **build_your** (2): Your first website | Your work
- **build_already** (1): This website is already unpublished.
- **build_anonymous** (1): Anonymous user
- **build_approving** (1): Approving
- **build_blocked** (1): Something in this browser may be blocking it.
- **build_bookmarked** (1): Bookmarked
- **build_bookmarks** (1): Bookmarks
- **build_canvas** (1): Canvas menu
- **build_check** (1): Your latest version failed a check.
- **build_choose** (1): Choose a website to publish.
- **build_couldnt** (1): Couldn’t copy
- **build_cursor** (1): Cursor: move and open websites
- **build_decide** (1): Your website has a newer saved version since Ted suggested this. Open it in {{build}} to p
- **build_deleted** (1): Website deleted
- **build_deleting** (1): Deleting…
- **build_denying** (1): Denying
- **build_duplicate** (1): Duplicate
- **build_duplicating** (1): Duplicating…
- **build_edited** (1): Edited {{date}}
- **build_enable** (1): Enable browser storage to keep this publishing request safe across reloads.
- **build_errors** (1): Build errors need fixing
- **build_find** (1): Find page or enter path
- **build_finishing** (1): Finishing the build…
- **build_first** (1): Ted is getting your first build started
- **build_frame** (1): Preview frame loaded
- **build_fullscreen** (1): Fullscreen is unavailable in this browser.
- **build_getting** (1): Getting started…
- **build_hand** (1): Hand: drag the canvas
- **build_head** (1): This version’s code doesn’t build, so it can’t be previewed.
- **build_homepage** (1): Homepage
- **build_importing** (1): Importing…
- **build_kind** (1): Website
- **build_latest** (1): Latest
- **build_link** (1): Link copied
- **build_menu** (1): Menu for {{title}}
- **build_message** (1): {{message}} Trying again…
- **build_newer** (1): A newer saved version is available.
- **build_not** (1): Not saved yet
- **build_previous** (1): The previous saved version could not compile. Publish the corrected saved version when it 
- **build_private** (1): If this keeps happening, try a private window or another browser.
- **build_read** (1): reading
- **build_redirects** (1): Redirects to {{path}}
- **build_redo** (1): Redo
- **build_references** (1): References
- **build_refreshing** (1): Refreshing preview…
- **build_release** (1): This release could not be published. Its saved files or publishing setup need attention be
- **build_removal** (1): We could not confirm removal. Retry unpublish safely with the same request.
- **build_removing** (1): Removing…
- **build_renaming** (1): Renaming…
- **build_restored** (1): Website restored
- **build_result** (1): We could not confirm the result. Retry safely with the same publishing request.
- **build_reverting** (1): Reverting…
- **build_save** (1): Save a version before publishing.
- **build_secrets** (1): Secrets changed. Reloading…
- **build_selected** (1): Selected website
- **build_setting** (1): Setting up
- **build_signing** (1): Signing you in…
- **build_source** (1): library
- **build_starting** (1): Starting
- **build_stay** (1): Stay signed out
- **build_test** (1): Test on live site
- **build_tools** (1): Tools
- **build_try** (1): Try to fix
- **build_trying** (1): Trying again…
- **build_undoing** (1): Undoing
- **build_unpublished** (1): <strong>Your website isn’t published.</strong> Social platforms and search engines can’t a
- **build_unpublishing** (1): Unpublishing…
- **build_url** (1): URL copied
- **build_versions** (1): Versions couldn’t be loaded. Trying again…
- **build_viewport** (1): Phone
- **build_visitor** (1): Visitor analytics
- **build_visits** (1): {{visits}} this week
- **build_waits** (1): This is a bigger change, so Ted didn’t publish it. Approve or Deny it on its card.
- **build_work** (1): Sample

### business

- **business_status** (1): foundable_status

### busy

- **busy_expired** (1): The network stayed busy for a day, so this post was not sent. Post a new draft to send it.
- **busy_missed** (1): The network was busy until this post's time passed, so it was not sent. Post a new draft w

### capture

- **capture_pageleave** (1): if_capture_pageview
- **capture_unavailable** (1): run_asset_capture_unavailable

### chat

- **chat_video** (83): Video | The video had problems, so it wasn’t made. | Download video
- **chat_computer** (54): Approved. Ted is pressing it… | Connecting to Ted’s computer… | Declined. Ted won’t press it.
- **chat_site** (42): After | Approve all | Before
- **chat_post** (29): Approved from your reply. | You can post it until {{date}}. | You can bring it back to drafts until {{date}}.
- **chat_paste** (27): Pasted brief: {{title}}, {{size}} | Pasted code: {{title}}, {{size}} | Pasted data: {{title}}, {{size}}
- **chat_build** (24): Build activity | Building | Coming next
- **chat_logo** (24): You can change your logo later. | Choose a logo to take a closer look. | Chosen from your reply: option {{option}} is your logo.
- **chat_text** (24): Text manually | Text START to resume. | Other ways to connect
- **chat_label** (17): Letting this website’s own tools save its records | Updating this website’s packages | Call ended
- **chat_welcome** (17): Show me some ideas | Let’s get started. | I have an idea
- **chat_secrets** (16): Add the secrets Ted asked for | Add these in {{build}} → Tools → {{security}}. | Loading secrets…
- **chat_copy** (14): Copy code | Copy error | Copy errors
- **chat_file** (14): {{name}} was deleted, so it can’t be opened here. | {{name}} wasn’t added: this business’s files are full. Delete files you no longer need in  | {{name}} wasn’t added: this business’s files are full on this plan. Upgrade for more room,
- **chat_rating** (14): Couldn’t send your feedback. Try again. | Additional feedback | Please tell us why this response wasn’t helpful to you.
- **chat_email** (13): Or type another domain | Declined in your reply. This email won’t be sent. | Email draft
- **chat_reply** (13): Declined in your reply. It won’t be sent. | Reply draft | More actions
- **chat_intake** (12): Add a smaller copy. | Add smaller copies. | Not added: {{names}}. Files can’t be added to this chat.
- **chat_request** (12): Help me change my business email | Find me a domain to buy for my business email | Find me a domain for {{name}}
- **chat_credits** (9): {{amount}} credit | {{amount}} credits | You have credits again, so Ted can pick up where he left off.
- **chat_dictation** (9): Couldn’t transcribe that. Your recording is kept. | Couldn’t read that recording. Try again. | No sound from your microphone.
- **chat_error** (9): Billing needs attention before Ted can run. | Check the latest messages before sending again. | Please check your message and try again.
- **chat_no** (9): No chats match “{{query}}”. | No conversations yet | No conversations match “{{query}}”
- **chat_queue** (9): You don’t have an active edit on this message | Message not found | Paused
- **chat_rename** (8): Rename | Rename conversation | Rename conversation: {{title}}
- **chat_who** (8): {{who}} can add these. | {{who}} can post it. | {{who}} can approve website changes.
- **chat_resend** (7): Please wait for the current operation to complete. | Cannot revert while operation in progress (e.g., a chat request) | Cannot revert while operation in progress
- **chat_sheet** (7): {{columns}} column | {{columns}} columns | Showing at most {{rows}} rows and {{columns}} columns. Download to view the full file.
- **chat_view** (7): View all history | View as | View {{name}} full size
- **chat_zip** (7): Archive contents | This ZIP holds no files. | Files in this ZIP
- **chat_fix** (6): Fix build error | Fix build errors | Set up database
- **chat_saving** (6): Saving… | Saving {{name}}… | Saving {{name}}… ({{waiting}} more waiting)
- **chat_show** (6): Show earlier messages | Show in text field | Show in text field: {{title}}
- **chat_brief** (5): This plan can’t start a build: Ted hasn’t saved it, or a different plan is already saved. | A different plan is already saved for this business, so this one can’t start a build. Ask  | Your plan couldn’t be saved. Try again.
- **chat_delete** (5): Delete | Couldn’t delete. Try again. | “{{title}}” leaves your chat history. Websites and drafts it made stay.
- **chat_load** (5): Load earlier messages | Load more conversations | You don’t have access to this conversation. Use New chat to start another conversation.
- **chat_open** (5): Couldn’t open this chat. | Open Messages | Open {{name}}
- **chat_opening** (5): Opening… | Opening the changes… | Opening your conversation…
- **chat_search** (5): Search chats | Search everything for “{{query}}” | Search chat history
- **chat_setup** (5): Setup is already complete. | Your existing plan is unchanged. Send your next message here to keep working with Ted. | Your business
- **chat_ted** (5): Ted’s activity | Ted reacted {{emoji}} | Ted replied
- **chat_website** (5): Bring my website over to Foundable with its code: {{address}} | Use my external site as it is: {{address}} | Bring in my existing website: {{address}}
- **chat_card** (4): Connect the app Ted asked for in Settings → {{integrations}}. | Connect the website to GitHub in {{build}} → Tools → {{github}}. | Reload this page to see the newsletter “{{subject}}”.
- **chat_change** (4): Added | Change email address | Modified
- **chat_connect** (4): Connect accounts | Connect apps | Gmail, Calendar, Slack and more
- **chat_diagnostics** (4): Connecting to the live model… | Live model · one available tool | Live model · {{count}} available tools
- **chat_disconnect** (4): Disconnect | Couldn’t disconnect. | Disconnect
- **chat_duration** (4): {{hours}}h {{minutes}}m | {{minutes}}m {{seconds}}s | {{seconds}}s
- **chat_message** (4): Message from Ted | Message Ted… | Sent
- **chat_mic** (4): Microphone blocked. Allow it in your browser’s site settings. | Your microphone is in use by another app. | No microphone found.
- **chat_not** (4): Not helpful | Ted couldn’t continue. | Couldn’t send the fix request.
- **chat_remove** (4): Remove | Remove {{name}} | Remove pasted text: {{title}}
- **chat_revert** (4): Revert | Revert and resend | Your message will be updated, and the conversation continues from here. Changes after this
- **chat_run** (4): Stopped | Worked through {{count}} step | Worked through {{count}} steps
- **chat_signed** (4): Create your free account | Love it. Sign up and I’ll build your business and run it for you. | I’ve got one you’ll love. Sign up and I’ll build it and run it for you.
- **chat_stop** (4): Stop build | Stop Ted’s computer | Stop response
- **chat_suggested** (4): Suggested ideas | Suggested message: {{text}} | Suggested names
- **chat_your** (4): your business | Your message | Your own answer
- **chat_add** (3): Add | Add photos & files | Pictures, PDFs and documents
- **chat_cancel** (3): Cancel | Cancel dictation | Cancel editing
- **chat_details** (3): Details | Your business details couldn’t be updated. | Updating your business details…
- **chat_document** (3): Document: {{title}} | {{number}} word | {{number}} words
- **chat_edit** (3): Cannot edit while operation in progress | Edit message | Edit {{name}}
- **chat_ideas** (3): Here are some ideas I thought would be a good fit for you. | These ideas are saved in your conversation. | Here are some ideas.
- **chat_loading** (3): Loading conversations… | Loading earlier messages… | Loading more conversations…
- **chat_new** (3): New chat in Messages | New conversation | Shift ↵ for a new line
- **chat_posts** (3): Posts | {{count}} post | {{count}} posts
- **chat_preview** (3): Preview | Preview is out of date | Preview version
- **chat_publishing** (3): Publishing can take about a minute. | Publishing your site | Publishing your site…
- **chat_retry** (3): Retry history | Retry stop | Retry upload
- **chat_reverted** (3): Hide | Reverted messages | Show
- **chat_secret** (3): Replace | Replace {{name}} | Set
- **chat_setback** (3): Something stopped me picking up where I left off. Just hit Continue and I’ll carry on. | {{app}}’s connected, but something stopped me picking up where we left off. Just hit Conti | Something stopped me picking the build back up. Just hit Continue on it and I’ll carry on.
- **chat_teds** (3): Ted’s number | Ted’s questions | Ted’s version
- **chat_waiting** (3): Waiting to send. Ted gets it as soon as you’re back online. | Waiting to send. | Your waiting messages can’t be checked right now. Ted may still pick them up.
- **chat_work** (3): Uses credits | Do this | Get more credits to do this
- **chat_actions** (2): Chat actions | Chat actions: {{title}}
- **chat_already** (2): Already live | This version was already live, so nothing changed.
- **chat_carried** (2): From your waitlist chat | You’re in! I remember what we talked about. Tell me when you’re ready and we’ll pick up fr
- **chat_choose** (2): Choose a name | Choose workspace file
- **chat_close** (2): Close all history | Close Text Ted
- **chat_couldnt** (2): Couldn’t save | Couldn’t save your rating.
- **chat_credit** (2): Ted stopped here: you’re out of credits. | Ted stopped here: this turn reached its credit limit. Send a follow-up to continue.
- **chat_earlier** (2): Earlier messages could not be loaded. Try again. | Earlier posts
- **chat_empty** (2): What can I do for you? | No conversations yet. Your chats will appear here after you send a message.
- **chat_files** (2): {{first}}, {{second}} and {{count}} more | {{first}} and {{second}}
- **chat_finish** (2): Finish | Finish dictation
- **chat_follow** (2): Connection lost. Reconnect to keep following this turn. | Please sign in again to keep following this turn.
- **chat_home** (2): I set up {{business}} and built {{website}}, which you’ll find in Build. Ask me here for a | I set up {{business}}. Ask me here for anything, like a website, an email to a customer or
- **chat_in** (2): {{run}} is using this chat. Stop {{run}} first. | {{run}} is using it
- **chat_intro** (2): Hey, I’m Ted! Give me a moment to find a few businesses that fit you. Pick one and I’ll ge | Hey, I’m Ted! Leave this one to me: I’ll choose a business for you, plan it and make your 
- **chat_model** (2): This is taking longer than usual. | Ted is still on it.
- **chat_more** (2): More name ideas | More posts
- **chat_next** (2): Next question | Next slide
- **chat_older** (2): {{count}} older commit | {{count}} older commits
- **chat_out** (2): Out of credits until {{date}} | Out of credits until {{time}}
- **chat_pasted** (2): Pasted text | Pasted with this message
- **chat_payment** (2): Update your payment details to keep building. | Your latest payment didn’t go through
- **chat_pdf** (2): This PDF can’t be shown here. | This file can’t be shown in this browser.
- **chat_pixels** (2): {{count}} pixel | {{count}} pixels
- **chat_prediction** (2): Press Tab, Right Arrow or Enter to edit it before sending. Escape leaves the message field | Tap to accept adds it to your message for editing before sending. You can also type your o
- **chat_previewing** (2): Previewing | Already showing in live preview
- **chat_previous** (2): Previous question | Previous slide
- **chat_quote** (2): Remove quote | Reply
- **chat_recent** (2): Couldn’t load recent messages. Trying again… | Couldn’t load recent messages. Reconnect to update this conversation.
- **chat_reference** (2): Reference image | Reference image {{number}}
- **chat_renamed** (2): Your business is now called {{name}}. | Renamed from your reply: your business is now called {{name}}.
- **chat_save** (2): Save | Save as file
- **chat_scan** (2): Scan to start a new chat. | Scan with your phone’s camera, then press Send.
- **chat_security** (2): Fix this security issue in my website | Fix these {{count}} security issues in my website
- **chat_send** (2): Send message | Send one text to connect.
- **chat_start** (2): Start build | Build the website for {{name}}
- **chat_version** (2): Couldn’t bring that version back. Try again. | {{number}} of {{total}}
- **chat_voice** (2): Voice input | Voice input isn’t available here
- **chat_words** (2): A message holds up to {{limit}} characters. Remove {{number}} character to send. | A message holds up to {{limit}} characters. Remove {{number}} characters to send.
- **chat_addresses** (1): Your email and site addresses stay the same.
- **chat_all** (1): All chat history
- **chat_answers** (1): Answers sent
- **chat_app** (1): Reload the page to approve or decline this change.
- **chat_attachments** (1): Attachments aren’t available here
- **chat_audio** (1): This recording can’t play in this browser. Download it to listen to it.
- **chat_back** (1): Back to latest
- **chat_business** (1): Business ideas
- **chat_cant** (1): Can’t scan?
- **chat_changes** (1): Couldn’t open the changes.
- **chat_check** (1): Check your connection.
- **chat_clear** (1): Clear search
- **chat_connection** (1): Connection interrupted. Reconnecting to this turn…
- **chat_context** (1): We couldn’t open this context right now.
- **chat_continue** (1): Continue
- **chat_conversation** (1): Conversation
- **chat_conversations** (1): Conversations couldn’t be loaded.
- **chat_copied** (1): Copied
- **chat_could** (1): Could not send
- **chat_current** (1): Current conversation
- **chat_deleting** (1): Deleting…
- **chat_dictate** (1): Dictate
- **chat_different** (1): Different ideas
- **chat_disconnecting** (1): Disconnecting…
- **chat_dismiss** (1): Dismiss
- **chat_download** (1): Couldn’t download {{name}}. Try again.
- **chat_downloading** (1): Downloading…
- **chat_drop** (1): Drop photos and files to add them
- **chat_edited** (1): Edited by you
- **chat_ended** (1): This response ended early. You can ask Ted to continue.
- **chat_esc** (1): Press Esc again to stop
- **chat_first** (1): First message from Ted
- **chat_free** (1): Free
- **chat_from** (1): From GitHub: {{title}}
- **chat_general** (1): General ideas
- **chat_get** (1): Get more credits
- **chat_github** (1): Your code in repositories you own
- **chat_greeting** (1): Hey, I’m Ted! Tell me what you have in mind, even if it’s just a rough thought. We’ll find
- **chat_held** (1): You, not read by Ted yet: 
- **chat_helpful** (1): Helpful
- **chat_hide** (1): Hide details
- **chat_history** (1): History
- **chat_idea** (1): Who it’s for:
- **chat_interrupted** (1): This message was interrupted.
- **chat_jump** (1): Jump to latest
- **chat_markdown** (1): Source
- **chat_on** (1): On this page
- **chat_other** (1): Other build updates
- **chat_page** (1): Page {{number}} of {{total}}
- **chat_please** (1): Please try again.
- **chat_press** (1): Press Tab to accept
- **chat_publish** (1): Publish
- **chat_question** (1): <sr>Question </sr>{{step}} of {{count}}
- **chat_quotes** (1): Quoted from Ted
- **chat_read** (1): Read by Ted
- **chat_recall** (1): {{position}}/{{total}} in history
- **chat_reconnect** (1): Reconnect
- **chat_redo** (1): Redo
- **chat_renaming** (1): Renaming…
- **chat_replaced** (1): It replaced {{sites}}, since a business has one live site.
- **chat_report** (1): Report a problem
- **chat_resize** (1): Resize chat history
- **chat_resume** (1): Resume sending queued messages
- **chat_runs** (1): Runs after the current task
- **chat_saved** (1): Saved chats
- **chat_selected** (1): Selected
- **chat_sent** (1): Sent with
- **chat_settings** (1): Change {{things}}
- **chat_slide** (1): Slide {{number}} of {{total}}
- **chat_slides** (1): Slides
- **chat_something** (1): Something else
- **chat_sources** (1): Sources
- **chat_spreadsheet** (1): This spreadsheet’s preview can’t be shown. Download it to open it.
- **chat_starting** (1): Starting dictation
- **chat_status** (1): Status unavailable
- **chat_step** (1): Ted reached this turn’s step limit. Send a follow-up to continue.
- **chat_talk** (1): Talk to Ted
- **chat_tap** (1): Tap to accept
- **chat_texted** (1): Text
- **chat_thinking** (1): Thinking
- **chat_too** (1): This file is too big to preview here. Download it to open it.
- **chat_turn** (1): Ted could not finish this turn. You can send a follow-up message.
- **chat_unavailable** (1): Unavailable
- **chat_undo** (1): Undo
- **chat_update** (1): Update preview
- **chat_versions** (1): Versions
- **chat_visit** (1): Visit site
- **chat_worked** (1): Worked for
- **chat_you** (1): You: 

### check

- **check_in** (1): monitor

### checks

- **checks_failed** (1): Build stopped: the changed website failed its tests. Nothing was saved.

### cinema

- **cinema_studio** (1): Cinema Studio

### client

- **client_report** (1): internal

### code

- **code_download** (1): code_export_plan_required

### common

- **common_show** (2): Show less | Show more
- **common_back** (1): Back
- **common_cancel** (1): Cancel
- **common_close** (1): Close
- **common_confirm** (1): Confirm
- **common_continue** (1): Continue
- **common_copied** (1): Copied
- **common_copy** (1): Copy
- **common_crawl** (1): Common Crawl
- **common_delete** (1): Delete
- **common_done** (1): Done
- **common_download** (1): Download
- **common_edit** (1): Edit
- **common_loading** (1): Loading…
- **common_next** (1): Next
- **common_open** (1): Open
- **common_refresh** (1): Refresh
- **common_remove** (1): Remove
- **common_retry** (1): Retry
- **common_save** (1): Save
- **common_saved** (1): Saved
- **common_saving** (1): Saving…
- **common_send** (1): Send
- **common_try** (1): Try again
- **common_upgrade** (1): Upgrade

### company

- **company_memory** (3): remembering | remembering | remembering
- **company_unavailable** (1): not_found

### composition

- **composition_size** (1): size

### confirming

- **confirming_stop** (1): Build is confirming its result and stopping any remaining work.

### connection

- **connection_required** (1): The {connection} connection needs reconnecting, so nothing was created. Reconnect it in Ru

### content

- **content_type** (1): application/vnd.sentry.items.log+json

### credits

- **credits_ran** (1): Build stopped before changing anything: the owner's credits ran out.

### design

- **design_ted** (14): Ted, out of budget | Ted, building | Ted, out of credits
- **design_type** (3): Type it exactly as shown, capitals and spaces included. | Type {{phrase}} | Type <strong>{{phrase}}</strong> to confirm.
- **design_choose** (1): Choose…
- **design_close** (1): Close image preview
- **design_dismiss** (1): Dismiss notification
- **design_download** (1): Download image
- **design_free** (1): Free run
- **design_notifications** (1): Notifications, shortcut alt+T
- **design_on** (1): on {{date}}
- **design_recommended** (1): Recommended
- **design_refresh** (1): Couldn’t refresh.
- **design_refreshing** (1): Refreshing…
- **design_refused** (1): Foundable can't make this website: the picture services refused its design. Nothing was sa
- **design_send** (1): Send your answer
- **design_teds** (1): Ted’s pick

### domain

- **domain_purchase** (1): domain_purchase_plan_required

### domains

- **domains_dns** (68): DNS record actions | Actions | DNS record actions: {{record}}
- **domains_ns** (44): Add nameserver | Change anyway | Changing…
- **domains_own** (37): Add these records where you got your domain. | If this domain uses Cloudflare or a similar proxy, disconnect it here and connect it again | This domain is not available for this site. Remove it and add it again to reconnect it.
- **domains_connect** (34): Connect | {{hostname}} is already connected to this site. | Something went wrong checking your domains. Try again later.
- **domains_card** (31): Available | <b>{{balance}}</b> credit | <b>{{balance}}</b> credits
- **domains_transfer** (30): Unavailable during the transfer | Authorization code | Couldn’t fetch the authorization code.
- **domains_renewal** (25): Automatic renewal didn’t complete. Please try manual renewal. | Auto-renew failed | Auto-renew is off.
- **domains_note** (19): Your account is on hold, so domains can’t be bought or renewed. Contact support. | Couldn’t reach Foundable. Check your connection. | You don’t have enough credits for this domain. Upgrade your plan under Plans, then try aga
- **domains_state** (19): Auto-renew off | Connected | Couldn’t buy
- **domains_fix** (16): Registered, but we couldn’t point it at your site yet. | Registered, but we couldn’t confirm its privacy and renewal settings yet. | Registered, but it couldn’t be connected to your site.
- **domains_move** (15): Choose a business first. | Move domain | Couldn’t move the domain. Check your connection and try again.
- **domains_primary** (14): Primary | Primary domain | Your site’s other addresses send visitors here
- **domains_renew** (13): Renew | Add one more year to {{domain}}. | Renew domain
- **domains_order** (12): Your domain is connected. Securing your website before it goes live. | Registered. Pointing it at your site, usually in a few minutes. | Registered. Connecting your domain automatically.
- **domains_role** (12): Only the owner or an admin can buy domains. | Only the owner can buy domains. | Only the owner or an admin can change DNS records.
- **domains_all** (11): Date added | Couldn’t load your domains | No domains match “{{query}}”.
- **domains_toast** (11): Add the CNAME records shown in the domain settings to activate both domains. | Domains registered | Domain disconnected
- **domains_contact** (10): Ted couldn’t finish checking your website’s contact details. Ask him to try again. | Your website’s contact details were kept as they are. Ask Ted to review them with you. | Ted is checking your website’s contact details.
- **domains_record** (8): Copy name | Copy {{type}} name | Copy {{type}} value
- **domains_email** (7): Your email uses {{hostname}}, so your website can’t. Use {{website}} for your website. | Your email uses {{hostname}}, so your website can’t. Use another address for your website. | Your Inbox currently uses {{address}}.
- **domains_fact** (7): Expired | Expires | Price
- **domains_site** (7): Keep it where it is | Nothing changes for your visitors. | Nothing changes for your visitors. Ted can see it and help you grow it.
- **domains_buy** (6): Buy | Buy a domain | Buy another domain
- **domains_records** (6): I’ve added these records | DNS records to add at your DNS provider | @ means your domain itself. Where @ isn’t accepted, leave the name blank.
- **domains_search** (6): Search | Find a domain | Search a name, like sunroomstudio
- **domains_custom** (5): Enter the domain name you’d like to connect to your site. | e.g., example.com or subdomain.example.com | Domain name
- **domains_menu** (5): Expired | In review | Not yet
- **domains_checking** (4): Checking availability and pricing… | Checking domains… | Checking more endings…
- **domains_page** (4): Move it to one of your businesses to use it again. | {{domain}} shows your site. | Your site’s other addresses send visitors to {{domain}}.
- **domains_refused** (4): The order couldn’t go through on our side. | The registry turned the order down. | Someone else registered it first.
- **domains_registration** (4): Registration | Another registrar holds this domain now. | Foundable holds this domain for you.
- **domains_actions** (3): Domain actions | Domain actions: {{domain}} | {{name}} actions
- **domains_auto** (3): Auto-renew | Auto-renew {{domain}} | Auto-renew {{domain}}
- **domains_configure** (3): Advanced | Uses Cloudflare or similar proxy | More information about proxy mode
- **domains_deleted** (3): Deleted | This domain isn’t renewed or connected to a site until you move it to one of your business | {{foundable}} was deleted
- **domains_disconnect** (3): Disconnect | This will disconnect the domain from this site. You will need to reconfigure it if you wan | Disconnect {{hostname}}?
- **domains_row** (3): Expired {{day}}. | Expires {{day}}, and your site stops showing there. | Renews {{day}} from your credits.
- **domains_website** (3): Website | Your domain is connected. Checking whether your website is published. | Your domain is connected. Publish your website to show it here.
- **domains_check** (2): Check your connection. | Check status
- **domains_credits** (2): {{count}} credit | {{count}} credits
- **domains_elsewhere** (2): You bought this domain somewhere else, so its registration stays there. These records conn | Registered elsewhere
- **domains_endings** (2): {{count}} ending. Type one to check it first, like sunroomstudio.studio | {{count}} endings. Type one to check it first, like sunroomstudio.studio
- **domains_filter** (2): All | Under {{ceiling}}
- **domains_first** (2): {{count}} credit for the first year | {{count}} credits for the first year
- **domains_forward** (2): Forwards to {{main}}. | Turn on forwarding to {{main}} where you got your domain.
- **domains_more** (2): More domain actions | More domain actions: {{domain}}
- **domains_orders** (2): Domains bought through Foundable | No domains yet. A domain you buy shows up here.
- **domains_pair** (2): Your site is live on this domain. | Not connected.
- **domains_price** (2): The price is now {{count}} credit. | The price is now {{count}} credits.
- **domains_purchase** (2): Purchase closed. | Buying domains is not available right now.
- **domains_store** (2): Couldn’t check whether domains are for sale here. | Checking whether domains are for sale here…
- **domains_transferred** (2): It moved to another registrar on {{day}} and can no longer be managed here. | Domain transferred out
- **domains_back** (1): Back to all domains
- **domains_buying** (1): Buying…
- **domains_connecting** (1): {{domain}} is connecting
- **domains_copy** (1): Copy failed
- **domains_couldnt** (1): Couldn’t copy
- **domains_deleting** (1): Deleting…
- **domains_gone** (1): That domain or business is no longer here.
- **domains_loading** (1): Loading your domains…
- **domains_moved** (1): Moved to {{foundable}}.
- **domains_moving** (1): Moving…
- **domains_off** (1): Off
- **domains_on** (1): On
- **domains_processing** (1): Processing…
- **domains_purchases** (1): Couldn’t check domain purchases.
- **domains_quote** (1): This price has expired. Ask Ted for a fresh price before buying.
- **domains_reload** (1): Reload
- **domains_results** (1): Domains for {{query}}
- **domains_save** (1): Save changes
- **domains_searching** (1): Searching…
- **domains_set** (1): Set it up by hand
- **domains_starting** (1): Starting…
- **domains_then** (1): then {{credits}} a year
- **domains_unsupported** (1): {{note}} Try {{endings}} or another of {{total}}.
- **domains_view** (1): View more endings

### draft

- **draft_email** (1): writing
- **draft_foundable** (1): search
- **draft_reply** (1): writing

### duration

- **duration_too** (2): length | length

### edit

- **edit_exact** (2): Saving the change. | Making the change and checking it.
- **edit_authoring** (1): Building the requested changes.
- **edit_post** (1): writing
- **edit_saving** (1): Saving the requested changes.
- **edit_verifying** (1): Requested changes checked and ready to save.
- **edit_writing** (1): Making the changes.

### enlarge

- **enlarge_pictures** (1): drawing

### external

- **external_reference** (1): outside

### file

- **file_too** (2): size | length
- **file_not** (1): file
- **file_refused** (1): file
- **file_size** (1): file_size_plan_required

### film

- **film_length** (1): length

### find

- **find_businesses** (1): searching
- **find_data** (1): searching
- **find_photos** (1): searching

### first

- **first_checks** (1): Build stopped: the new website failed its tests. Nothing was saved.
- **first_interrupted** (1): Build was interrupted. Nothing was saved.
- **first_refused** (1): Foundable's AI declined this request. Nothing was saved.
- **first_screen** (1): run_asset_framing_first_screen
- **first_source** (1): Build stopped: the new website's files could not be saved. Nothing was saved.

### folder

- **folder_size** (1): folder_size_plan_required

### font

- **font_family** (1): font

### foundable

- **foundable_status** (1): research

### frame

- **frame_role** (1): build_preview
- **frame_size** (1): frame

### full

- **full_page** (1): run_asset_framing_full_page

### get

- **get_data** (1): searching

### getting

- **getting_ready** (1): Build is getting ready.

### git

- **git_recovery** (61): After the restore, Foundable syncs your work to your repository. If the repository has new | A repository push replaced it again. It’s still on {{branch}}. Merge it into {{main}} with | Your saved work is already in your website, so there’s nothing to restore.
- **git_refusal** (21): Foundable’s GitHub app can no longer reach that account. Check the app’s access on GitHub, | GitHub doesn’t list that account for you. Install Foundable on it, then try connecting aga | This website already syncs with a GitHub repository.
- **git_sync** (19): Once the problem above is fixed, Re-check sends them to GitHub. | Foundable and GitHub have diverged | Each side has commits the other doesn’t ({{foundable}} in Foundable, {{github}} on GitHub)
- **git_kept** (17): a credential file | credential files | Foundable keeps secrets in App Secrets
- **git_connect** (8): Connect | Connect {{account}} | Connect GitHub
- **git_toast** (8): GitHub app connected! | GitHub wasn’t connected because the authorization was cancelled. | The Foundable app is installed on {{account}}. Press Connect beside it to finish.
- **git_branch** (7): Branch: {{branch}} | Branch name | Invalid branch name
- **git_disconnect** (7): Disconnect | Your code will remain in both Foundable and GitHub, but changes will no longer be synchron | This website couldn’t be disconnected.
- **git_unlink** (7): Unlink | Unlink {{count}} website | Unlink {{count}} websites
- **git_held** (6): You need admin access to add a connection | You need admin access to connect this repository | You need admin access to delete this connection
- **git_no** (6): No branches found | No connections yet | Add one to start syncing your websites with GitHub.
- **git_column** (5): Branch | Name | Owner
- **git_refused** (5): GitHub’s newest commit can’t come into Foundable. Change it on GitHub, then Re-check. | And {{files}}. | A website needs its index.html page.
- **git_add** (4): Add account | Add another GitHub account | Add connection
- **git_commits** (4): {{count}}+ commits | {{count}}+ commits | {{count}} commit
- **git_divert** (4): Newer commits on {{branch}} and your changes couldn’t be combined automatically. | {{cause}} They were pushed to the branch {{diverted}} instead. Merge that branch into {{br | GitHub refused changes to {{branch}}, which a rule on GitHub protects.
- **git_install** (4): Install | Install on new account | Install the Foundable app on another GitHub account
- **git_lost** (4): Foundable no longer has access to this repository. Reconnect and grant access to it. | This repository is no longer accessible. Try reconnecting, or disconnect to connect this w | This repository is no longer accessible. Try reconnecting, or contact support if the issue
- **git_more** (4): {{count}}+ more files | {{count}}+ more files | {{count}} more file
- **git_clone** (3): Clone | Clone with | Clone with {{way}}
- **git_delete** (3): Delete this connection | will not be deleted. | The GitHub repository
- **git_intro** (3): Sync saved versions to a private repository you own. | Select a website to sync it with GitHub. | Keep your code in GitHub
- **git_reauthorize** (3): Connecting… | Re-authorize as {{login}} | Re-authorize as {{login}} to continue.
- **git_remove** (3): This action cannot be undone. This will permanently delete the connection and disconnect a | The {{account}} connection couldn’t be deleted. | Delete connection
- **git_repository** (3): The repository wasn’t made because the authorization on GitHub was cancelled. | The repository couldn’t be made. | GitHub repository
- **git_select** (3): Select all websites | Select installation | Choose an existing GitHub installation or install on a new account
- **git_branches** (2): Branches | GitHub’s branches couldn’t be listed.
- **git_coming** (2): Coming soon | Syncing with GitHub isn’t available yet.
- **git_developers** (2): Branch and clone link | Branch, clone link, saved work
- **git_find** (2): Find a branch | Find a branch…
- **git_installation** (2): The Foundable GitHub App is suspended. Reconnect and unsuspend it to resume syncing. | The Foundable GitHub App has been uninstalled. Reconnect to reinstall it and restore acces
- **git_kind** (2): Organization | Personal account
- **git_last** (2): Last synced {{ago}} | Last updated {{ago}}
- **git_linked** (2): Linked websites | These websites are synced with this connection.
- **git_names** (2): {{names}} and {{count}} more | {{names}} and {{count}} more
- **git_recheck** (2): Re-check | Re-check sync status
- **git_switch** (2): The branch couldn’t be switched. | Failed to switch branch on {{website}}
- **git_switched** (2): Now using branch: {{branch}} | Branch switched on {{website}}
- **git_switching** (2): Preparing to switch… | Switching branch on {{website}}
- **git_syncing** (2): Preparing to sync… | Syncing {{website}} with GitHub
- **git_used** (2): Currently used in <strong>{{count}} website</strong> | Currently used in <strong>{{count}} websites</strong>
- **git_view** (2): View {{branch}} | View on GitHub
- **git_website** (2): website | Website name
- **git_websites** (2): {{count}} website | {{count}} websites
- **git_accounts** (1): GitHub accounts
- **git_app** (1): Foundable reads your code through the Foundable app. Install it on the GitHub account that
- **git_archived** (1): This repository is archived on GitHub, so it can’t take new commits. Unarchive it on GitHu
- **git_available** (1): Available installations
- **git_back** (1): Back to branches
- **git_check** (1): GitHub couldn’t be checked.
- **git_checked** (1): Checked {{ago}}
- **git_checking** (1): Checking GitHub…
- **git_configure** (1): Configure on GitHub
- **git_connecting** (1): Connecting…
- **git_connections** (1): GitHub connections
- **git_copied** (1): Copied {{way}}
- **git_copy** (1): Copy {{way}}
- **git_create** (1): Create branch
- **git_created** (1): Created by {{name}}, last updated {{ago}}
- **git_deleting** (1): Deleting…
- **git_disconnected** (1): Website disconnected from GitHub
- **git_disconnecting** (1): Disconnecting…
- **git_finish** (1): Your GitHub connection couldn’t be finished.
- **git_finishing** (1): Finishing your GitHub connection…
- **git_for** (1): For developers
- **git_loading** (1): Loading branches…
- **git_new** (1): Foundable makes a new private repository for this website. It’s yours.
- **git_organizations** (1): Organizations without app installed
- **git_pane** (1): Connect GitHub accounts and organizations, then link websites to repositories.
- **git_reconnect** (1): Reconnect
- **git_reconnected** (1): Reconnected to {{repository}}
- **git_refresh** (1): Couldn’t refresh. Trying again…
- **git_suspended** (1): Suspended
- **git_synced** (1): {{website}} synced
- **git_uninstalled** (1): Uninstalled
- **git_unlinking** (1): Unlinking…
- **git_wait** (1): Wait for the step on its way.

### google

- **google_analytics** (1): Google Analytics
- **google_calendar** (1): Google Calendar
- **google_docs** (1): Google Docs
- **google_drive** (1): Google Drive
- **google_search** (1): Google Search Console
- **google_sheets** (1): Google Sheets

### history

- **history_read** (1): remembering
- **history_search** (1): remembering

### home

- **home_talk** (74): Let’s talk about the {{network}} ad you drafted, “{{name}}” (ad {{id}}). | Let’s talk about the business plan you prepared for {{name}}. | Let’s talk about the email you drafted, “{{title}}”.
- **home_kind** (32): Ad | Ad draft | App change
- **home_ai** (17): Ask the owner to see their plan in Settings. | Change the limit | Your credits are running low
- **home_email** (13): Email address checked | Address on their website | Email from {{sender}}
- **home_next** (13): Suggested tasks | You’ve started every task. | What you get
- **home_log** (12): Changed a document | Changed a PDF | Changed a presentation
- **home_col** (11): Amount | Customer | First seen
- **home_website** (10): Website fix | Add details | Add your details for {{website}}
- **home_ad** (9): Your ad finished | Your ad didn’t start | Nothing was spent. Your {{amount}} is back in your ad money.
- **home_open** (9): Open | Open Build | Couldn’t open this draft.
- **home_posts** (9): Posts | Posts published per day over the last {{days}} days; use the arrow keys to read a day | Posts published in all over the last {{days}} days; use the arrow keys to read a day
- **home_counts** (8): {{count}} thing done | {{count}} things done | {{count}} sent or published
- **home_run** (8): Live | Paused | Running
- **home_social** (8): Social figures | No numbers from the networks yet; they arrive as the networks measure your posts. | Numbers are what each network last reported, first about {{minutes}} minutes after a post 
- **home_customers** (7): Customers | {{count}} customer | {{count}} customers
- **home_last** (7): Last 12 months | Last 6 months | Last 6 months · newest {{amount}} sales
- **home_loading** (7): Loading your account… | Loading Ted’s activity… | Loading email…
- **home_no** (7): No channels yet | No customers match. | No customers yet
- **home_range** (7): Last 14 days | Last 24 hours | Last 30 days
- **home_your** (7): Your business email | Your business plan | Your first sale
- **home_ended** (6): Billing needs attention | Budget used | Done
- **home_ted** (6): Ted’s activity | Ted at work | Ted changed your website
- **home_teds** (6): Ted’s change | Ted’s change for {{poster}} | Ted’s draft
- **home_connect** (5): Connect account | Connect accounts | Connect a channel
- **home_held** (5): Waiting for you to put your website live. | Taking a short break. | Waiting for replies and news.
- **home_idle** (5): I have one draft waiting for approval. | I have {{count}} drafts waiting for approval. | I have one draft waiting for your OK.
- **home_period** (5): Period | 12M | 30D
- **home_post** (5): This post didn’t go out | Post to {{networks}} | We tried twice and it didn’t go through.
- **home_sales** (5): Sales | {{count}} sale | {{count}} sales
- **home_saved** (5): Saved for later | Saved in {{place}} | View
- **home_buyer** (4): New | One-time | Regular
- **home_device** (4): Device | Desktop | Mobile
- **home_file** (4): This file isn’t in your business’s files. | Couldn’t open this file. | A file Ted made
- **home_first** (4): Your first build will appear here | Tell Ted about your business. What he builds will show up here. | Your first sale shows up here the moment it’s paid.
- **home_free** (4): Here’s what I’ve done so far! | Here’s where I’d go next. | Your free run is ready. Start it whenever you like.
- **home_keep** (4): Keep going | Keep Ted working | Buy credits to keep Ted working
- **home_metric** (4): Bounce rate | Views per visit | Visit duration
- **home_read** (4): Read it | Read whole email | Read whole post
- **home_vs** (4): vs prior 30 days | vs prior 7 days | vs prior 90 days
- **home_all** (3): All countries | All customers | All time
- **home_by** (3): By revenue · all sales | By revenue · newest {{amount}} sales | By Ted · {{standing}}
- **home_change** (3): Change in {{app}} | Change to your website | A change to your website
- **home_check** (3): Check connections | Couldn’t check what’s waiting for approval. | Couldn’t check what’s waiting on you.
- **home_connecting** (3): Connecting account… | Connecting accounts… | Connecting {{network}}…
- **home_from** (3): From Ted | What Ted makes for you will appear here. | From your direction
- **home_globe** (3): Website visitor locations globe. Drag to rotate; focus a place for its visits. | {{place}}: {{visits}} visit | {{place}}: {{visits}} visits
- **home_limit** (3): Close to your credit limit | Past half your credit limit | Well within your credit limit
- **home_not** (3): Not available | Not measured yet | Not now
- **home_replied** (3): Replied | {{name}} replied. | {{name}} replied to your email.
- **home_report** (3): {{credits}} credit used | {{credits}} credits used | What Ted has done so far
- **home_revenue** (3): Revenue | Revenue by month | Revenue by offer
- **home_runs** (3): Runs | Earlier | Now
- **home_search** (3): Google Search ad | Search customers | Search customers…
- **home_see** (3): See the post | See the whole ad | See the whole change
- **home_setup** (3): I’ve set up {{address}} as your business email. | I’ve designed a logo for your business. | I’ve written your business plan: who it’s for, what you offer and where to start.
- **home_visit** (3): Visit count | Visit {{host}} | Visit site
- **home_visitors** (3): Visitors | Visitors summary | Visitor data is unavailable.
- **home_visits** (3): Visits | visit | visits
- **home_amount** (2): {{amount}} this month | {{amount}} this week
- **home_approved** (2): Approved | Approved · {{standing}}
- **home_as** (2): as last reported | as of {{day}}
- **home_back** (2): Back to Home | Back to latest
- **home_between** (2): Lining up my next step | Thinking through the next step
- **home_buyers** (2): Buyers | Buyers back again
- **home_chart** (2): {{metric}} by day. Use the arrow keys to read each day. | {{metric}} by hour. Use the arrow keys to read each hour.
- **home_checking** (2): Checking what’s waiting for approval… | Checking what’s waiting on you…
- **home_copy** (2): Copy table | Copy text
- **home_country** (2): Country | Unknown
- **home_current** (2): {{amount}} current visit | {{amount}} current visits
- **home_draft** (2): Next of {{number}} waiting | Previous of {{number}} waiting
- **home_field** (2): Caption | Message
- **home_guest** (2): Guest buyer | G
- **home_live** (2): Live | Live · {{title}}
- **home_load** (2): Load more | Try loading more again
- **home_mark** (2): Mark all read | Couldn’t mark that read just now. Try again.
- **home_new** (2): New customers | New page
- **home_nothing** (2): Nothing published yet | Nothing to see yet
- **home_notifications** (2): Notifications | You’re all caught up.
- **home_page** (2): Page | Page views
- **home_paid** (2): Paid of started | Paid orders
- **home_payments** (2): Payments aren’t on yet | Start accepting payments and your revenue, orders and best sellers show up here.
- **home_repeat** (2): Repeat buyers | Repeat rate
- **home_reply** (2): Reply from {{name}} | Reply on {{network}}
- **home_rows** (2): {{count}} row | {{count}} rows
- **home_set** (2): {{title}} · Set up in {{place}} | Set up payments
- **home_source** (2): Source | Direct
- **home_tab** (2): Analytics | Social
- **home_things** (2): {{count}} thing | {{count}} things
- **home_top** (2): Top country | Top products
- **home_undo** (2): Undo | Couldn’t undo. Try again.
- **home_view** (2): View | All
- **home_account** (1): Your account is unavailable.
- **home_activity** (1): Couldn’t load Ted’s activity.
- **home_answer** (1): Your answer didn’t reach Ted. Try again.
- **home_app** (1): App change · Completed
- **home_average** (1): Average order
- **home_avg** (1): Avg order
- **home_best** (1): Best seller
- **home_card** (1): {{index}} of {{total}}
- **home_cards** (1): cards
- **home_channels** (1): Channels
- **home_checkout** (1): Checkout conversion
- **home_choose** (1): Choose a business to see its visitors.
- **home_comments** (1): Comments
- **home_daily** (1): Daily
- **home_declined** (1): Declined
- **home_delivered** (1): Delivered {{time}}
- **home_delta** (1): New
- **home_edited** (1): Edited by you
- **home_engagement** (1): Engagement
- **home_expand** (1): Expand {{card}}
- **home_explore** (1): Explore this
- **home_foundable** (1): Foundable AI
- **home_hours** (1): {{hours}} h ago
- **home_if** (1): If not now:
- **home_impressions** (1): Impressions
- **home_insights** (1): Insights
- **home_just** (1): just now
- **home_likes** (1): Likes
- **home_list** (1): {{items}} and {{last}}
- **home_location** (1): Location
- **home_made** (1): I made something for you.
- **home_metrics** (1): Metrics
- **home_min** (1): {{minutes}} min read
- **home_minutes** (1): {{minutes}} min ago
- **home_more** (1): +{{count}} more
- **home_name** (1): {{name}} replied
- **home_needs** (1): Needs you
- **home_network** (1): {{network}} post
- **home_newest** (1): Newest first
- **home_newsletter** (1): Newsletter for {{website}}
- **home_opening** (1): Opening this draft…
- **home_own** (1): Counted by your Google Analytics.
- **home_paused** (1): I’m paused.
- **home_paying** (1): Paying buyers
- **home_per** (1): Per paid order
- **home_performance** (1): Performance overview
- **home_posting** (1): Posting to {{networks}}.
- **home_published** (1): Published
- **home_rebuilt** (1): Rebuilt in Foundable
- **home_recent** (1): Recent sales
- **home_refunded** (1): Refunded
- **home_retrying** (1): Trying again after a hiccup…
- **home_review** (1): Review
- **home_row** (1): {{title}}: actions
- **home_sentence** (1): .
- **home_shares** (1): Shares
- **home_show** (1): Show
- **home_shown** (1): {{shown}} of {{total}}
- **home_sign** (1): Sign in to see your visitors.
- **home_someone** (1): Someone
- **home_step** (1): Start accepting payments
- **home_submitted** (1): Submitted for sending
- **home_taking** (1): Taking a new picture of your website
- **home_this** (1): This run so far
- **home_time** (1): Time period
- **home_title** (1): {{title}}, unread
- **home_total** (1): Total
- **home_unread** (1): {{count}} unread
- **home_up** (1): Up next
- **home_version** (1): Couldn’t bring that version back. Try again.
- **home_views** (1): Views
- **home_visiting** (1): Visiting now
- **home_waiting** (1): Waiting for your approval: {{items}}.
- **home_weekly** (1): {{label}}, weekly over the last 8 weeks
- **home_welcome** (1): Welcome back
- **home_what** (1): What I made
- **home_where** (1): Where Ted could go next
- **home_widgets** (1): Home widgets
- **home_work** (1): Couldn’t load your work.
- **home_written** (1): Written by Ted
- **home_wrote** (1): {{name}} wrote back
- **home_yesterday** (1): Yesterday
- **home_you** (1): You left {{ago}}

### identity

- **identity_required** (1): session_changed

### in

- **in_use** (1): run_asset_framing_in_use

### inbox

- **inbox_domain** (35): Approve it once where you got your domain. | Email on your own domain isn’t available yet. | Your email at {{domain}} keeps working.
- **inbox_notice** (25): Review and approve this exact revision before sending. | This business is not available for this account. | This changed elsewhere. Reopen it and try again.
- **inbox_out** (24): Draft approval revoked. | The approved draft changed. Review the server text before sending. | The draft change response was interrupted. Recover the server draft and review it before s
- **inbox_social** (19): Couldn’t load your social accounts. | This can’t be answered from here. | Choose the accounts Ted may use in {{run}}
- **inbox_own** (18): inbox_custom_domain_plan_required | Your email now sends from {{address}}, your own domain. Mail to {{old}} still arrives here | Send your email from {{address}}, your own domain, so it reaches inboxes.
- **inbox_phone** (17): Business number | Phone call | Call it now and hear Ted answer. Customers call it, and each call shows up here.
- **inbox_call** (14): Call didn’t go through | Phone call · {{length}} | Call in progress
- **inbox_reply** (13): Reply | Reply in {{platform}}. | Not delivered.
- **inbox_ted** (13): Quick question from Ted | Ted’s draft | Reply drafting is not configured for this business.
- **inbox_address** (12): Could not change the address. | Address changed. | Address check
- **inbox_loading** (12): Loading the call… | Loading your calls… | Loading comments…
- **inbox_no** (12): No calls yet | No comments yet. | We couldn’t find a mailbox at {{address}}, so this email probably won’t arrive.
- **inbox_who** (12): Only the owner or an admin can choose the accounts Ted may use in {{run}}. Everyone he tal | Only the owner can choose the accounts Ted may use in {{run}}. Everyone he talks to lands  | Only the owner or an admin can connect social accounts in {{run}}. Everyone he talks to la
- **inbox_count** (11): {{count}} archived message | {{count}} archived messages | {{count}} call
- **inbox_not** (11): {{address}} is not an email address. | Not attached: {{names}}. An email’s files can come to {{size}} at most. | Not attached: {{names}}. An email carries at most {{count}} file.
- **inbox_save** (9): {{name}} wasn’t saved: this business’s files are full. Delete files you no longer need in  | {{name}} wasn’t saved: this business’s files are full on its owner’s plan. Delete files yo | {{name}} wasn’t saved: this business’s files are full on this plan. Upgrade for more room,
- **inbox_email** (8): Email address | Email from {{from}} | Email in progress
- **inbox_record** (8): @ means {{domain}} itself. | Found | Needs a fix
- **inbox_write** (8): Write | Write a reply… | Not enough credits for Ted to write this email.
- **inbox_your** (8): Your domain | Your Gmail | Your Outlook
- **inbox_rewrite** (7): This email changed elsewhere, so Ted’s version wasn’t saved. Ask again to rewrite the new  | Not enough credits for Ted to rewrite this email. | Ted can’t rewrite emails for this business yet.
- **inbox_send** (7): Send anyway | Send at {{when}} | Send from you@yourdomain.com
- **inbox_sender** (7): Leave out Foundable’s name. | Sender name | Could not save the sender name.
- **inbox_empty** (6): Nothing archived yet | Archive mail from the inbox and it lands here. | Drafts you’re working on land here.
- **inbox_field** (6): That address is taken. Try another name. | Use letters, numbers, spaces and . ' - & only. | Enter a domain such as acme.com.
- **inbox_kind** (6): Comments | Comments on your post | Direct message
- **inbox_nd** (6): {{recipient}}: The mail service reported a delivery failure. The cause is not confirmed. | The mail service reported a delivery failure. The cause is not confirmed. | {{recipient}}: The mail service reported a temporary delivery problem.
- **inbox_show** (6): All | Email | Show fewer
- **inbox_term** (6): Bcc | Cc | Date
- **inbox_attachment** (5): attachment | Attachment | Shared post
- **inbox_blocked** (5): {{address}}: its owner asked not to get these emails. | {{address}}: The mail service reported a delivery failure. The cause is not confirmed. | {{address}}: The mail service reported a delivery failure. The cause is not confirmed.
- **inbox_failure** (5): This list is out of date. | This couldn’t be loaded. | This is no longer available on {{platform}}.
- **inbox_filter** (5): Filter | Channel | Read
- **inbox_identity** (5): Choose the address people will see. Replies arrive in {{inbox}}. | Use your domain for sending and replies. | Choose where to send from.
- **inbox_more** (5): More | More actions | Couldn’t load more calls.
- **inbox_use** (5): Use another Google account | Use another Microsoft account | Use a different domain
- **inbox_ago** (4): {{n}}d | {{n}}h | {{n}}m
- **inbox_mail** (4): Mail folder | Mail folders | Message
- **inbox_message** (4): Message | Message details: {{name}} | Message from {{from}}
- **inbox_reaction** (4): That reaction didn’t go. Try again. | {{platform}} isn’t answering right now, so that reaction didn’t go. | {{platform}} takes reactions only within {{count}} hour of their last message.
- **inbox_sr** (4): message | messages | Preview: 
- **inbox_state** (4): Cancelled | Failed | Sent
- **inbox_to** (4): To: | To: {{to}} | To {{to}}
- **inbox_change** (3): Change address | This email changed elsewhere, so your words weren’t saved. Save again to replace it. | Change email address
- **inbox_check** (3): Check again | Check setup | Check status
- **inbox_checking** (3): Checking… | Checking the address… | Checking the addresses…
- **inbox_connect** (3): Connect | Connect Google | Connect Microsoft
- **inbox_conversation** (3): Conversation | Conversation actions | Conversation actions: {{subject}}
- **inbox_new** (3): New email | From this address, Ted emails up to {{count}} new person a day to protect its reputation. | From this address, Ted emails up to {{count}} new people a day to protect its reputation.
- **inbox_replying** (3): Replying to {{name}} | Replying to this comment | Replying to:
- **inbox_sent** (3): Sent by Ted | Couldn’t load the mail you sent. | Sent to {{to}}
- **inbox_set** (3): Set it up by hand | Have Ted set this up | Tell him the address you want, and he does the rest.
- **inbox_add** (2): Add at least one recipient. | Add these records
- **inbox_archive** (2): Archive | Archive conversation
- **inbox_awaiting** (2): Finish talking to Ted about your business idea to get one. | No email address yet
- **inbox_calls** (2): Couldn’t load your calls. | Call <number>{{number}}</number> now and hear Ted answer. Each call shows up here.
- **inbox_card** (2): This email changed, so it wasn’t sent. Check the new version, then send it. | This email’s send time changed, so it wasn’t sent. Check the new time, then send it.
- **inbox_connected** (2): Connected email | Choose an email account
- **inbox_copy** (2): Copy failed | Copy {{type}} record for {{name}}
- **inbox_discard** (2): Discard changes | Discard unsaved changes?
- **inbox_full** (2): Couldn’t load the full email. Try again. | Full message text isn’t available.
- **inbox_keep** (2): Keep {{address}} | Keep editing
- **inbox_load** (2): Load more comments | Load older messages
- **inbox_move** (2): Move email | Could not move the mailbox.
- **inbox_needs** (2): Needs approval | Needs reply
- **inbox_on** (2): We’re setting up your business’s own email address. This page updates by itself. | Your email is on its way
- **inbox_open** (2): Open in {{platform}} | Open {{run}}
- **inbox_pill** (2): Not sent yet | Still sending
- **inbox_recipients** (2): {{to}} (+{{count}} more) | {{to}} (+{{count}} more)
- **inbox_replied** (2): Replied | Replied to your story
- **inbox_retry** (2): Retry recovery storage | Retry same send
- **inbox_review** (2): Review | This review has no written text.
- **inbox_search** (2): Search | Search mail
- **inbox_setup** (2): We’re still trying to set up your business’s email address. This page updates by itself. | Your email setup is taking longer
- **inbox_stars** (2): {{count}} out of 5 stars | {{count}} out of 5 stars
- **inbox_too** (2): One message can go to at most {{count}} recipient. | One message can go to at most {{count}} recipients.
- **inbox_view** (2): View in Files | View {{name}} in Files
- **inbox_waiting** (2): Goes out later | Waiting for you to sign in
- **inbox_all** (1): All channels
- **inbox_also** (1): Mail sent to {{addresses}} still comes to your Inbox.
- **inbox_applies** (1): Applies to
- **inbox_archived** (1): Archived
- **inbox_attach** (1): Attach files
- **inbox_attaching** (1): Attaching {{name}}…
- **inbox_back** (1): Back to {{place}}
- **inbox_bcc** (1): Bcc:
- **inbox_cancel** (1): Cancel send
- **inbox_cant** (1): Can’t be sent
- **inbox_cc** (1): Cc:
- **inbox_changing** (1): Changing…
- **inbox_choose** (1): Choose Reply under a comment to answer it.
- **inbox_claimed** (1): The mail service has this email; it may already have gone out. Check again in a moment.
- **inbox_clear** (1): Clear search and filters
- **inbox_close** (1): Close email setup
- **inbox_collapse** (1): Collapse all
- **inbox_comments** (1): These comments are out of date.
- **inbox_compose** (1): Compose
- **inbox_connecting** (1): Connecting…
- **inbox_copies** (1): Cc/Bcc, From:
- **inbox_current** (1): Current address
- **inbox_declined** (1): Declined
- **inbox_delivered** (1): Delivered
- **inbox_download** (1): Download {{name}}
- **inbox_downloading** (1): Downloading…
- **inbox_drafting** (1): Drafting your reply…
- **inbox_enter** (1): Enter the part before @{{domain}}.
- **inbox_everything** (1): Everything else
- **inbox_expand** (1): Expand all
- **inbox_file** (1): File
- **inbox_foundable** (1): Your Foundable email
- **inbox_from** (1): From:
- **inbox_has** (1): Has attachments
- **inbox_in** (1): In trash
- **inbox_inbox** (1): Couldn’t load your inbox.
- **inbox_lands** (1): Mail to {{address}} lands here.
- **inbox_mailbox** (1): Couldn’t load this mailbox.
- **inbox_mark** (1): Mark as unread
- **inbox_mentioned** (1): Mentioned you in their story
- **inbox_messages** (1): These messages are out of date.
- **inbox_moving** (1): Moving…
- **inbox_newest** (1): Newest first
- **inbox_older** (1): Couldn’t load older messages. Your open messages are still here.
- **inbox_oldest** (1): Oldest first
- **inbox_outgoing** (1): Outgoing mail
- **inbox_partly** (1): This long email is only partly shown.
- **inbox_picture** (1): Picture they sent
- **inbox_post** (1): This post has no text.
- **inbox_prevented** (1): Sending was prevented.
- **inbox_react** (1): React
- **inbox_read** (1): Read full message
- **inbox_reconcile** (1): Reconcile send
- **inbox_reconnect** (1): Reconnect
- **inbox_recover** (1): Recover saved draft
- **inbox_refreshing** (1): Refreshing…
- **inbox_rejected** (1): The mail provider rejected this message.
- **inbox_reload** (1): Reload
- **inbox_remove** (1): Remove {{name}}
- **inbox_removing** (1): Removing…
- **inbox_saved** (1): Saved to Files
- **inbox_seen** (1): Seen
- **inbox_sending** (1): Sending…
- **inbox_setting** (1): Setting up…
- **inbox_sign** (1): Sign in to see your mail.
- **inbox_signature** (1): Your logo, sent under your signature
- **inbox_sort** (1): Sort by date
- **inbox_start** (1): Start a new draft
- **inbox_stop** (1): Don’t use this domain for email
- **inbox_subject** (1): Subject:
- **inbox_they** (1): They reacted {{emoji}}
- **inbox_thread** (1): Couldn’t load this thread.
- **inbox_throwaway** (1): {{address}} is a throwaway or test inbox, so this email may not reach a person.
- **inbox_try** (1): Try another search or clear the filters.
- **inbox_unanswered** (1): unanswered
- **inbox_uncertain** (1): We couldn’t confirm this email was sent.
- **inbox_unknown** (1): Unknown sender
- **inbox_unreachable** (1): Can’t reach the server.
- **inbox_unread** (1): unread
- **inbox_updated** (1): Inbox updated
- **inbox_verified** (1): Verified
- **inbox_whats** (1): What’s loaded
- **inbox_writing** (1): Writing…
- **inbox_you** (1): you

### instagram

- **instagram_unlinked** (1): This ad names Instagram, but the chosen Facebook Page has no Instagram account linked to i

### insufficient

- **insufficient_credits** (1): credits

### interrupted

- **interrupted_unknown** (2): Creating this ad was interrupted before its network answered. Run asks again for a day, th | Creating this ad was interrupted before its network answered. It is held and never sent ag
- **interrupted_held** (1): Creating this ad was interrupted before {network} answered. It is held and never sent agai

### invalid

- **invalid_input** (1): invalid_request
- **invalid_request** (1): invalid_request
- **invalid_response** (1): invalid_response

### ip

- **ip_address** (1): {{auto}}

### language

- **language_automatic** (2): Automatic | Automatic ({{language}})

### layout

- **layout_text** (2): text | text

### line

- **line_app** (2): Messages | Share
- **line_joined** (2): Joined {{date}} | Joined {{when}}
- **line_email** (1): Email
- **line_in** (1): In line

### link

- **link_unavailable** (1): run_asset_capture_link_unavailable

### look

- **look_at** (1): reading

### make

- **make_logo** (1): drawing
- **make_pictures** (1): drawing

### managed

- **managed_account** (2): Facebook has shut the ad account Foundable Ads runs on, so this campaign stopped. Nothing  | Facebook paused the ad account Foundable Ads runs on for a while, and more than half of th
- **managed_interrupted** (2): Creating this campaign was interrupted before Facebook answered. Run asks again for a day, | Creating this campaign was interrupted before Facebook answered. It's held and never sent 
- **managed_launch** (2): This campaign couldn't start, so it stopped before spending anything. Ask Ted to propose i | Foundable Ads is full right now: Facebook limits how many ads can run at once on the Page 
- **managed_destination** (1): This campaign's link no longer opens one of this business's live websites, so it stopped. 
- **managed_host** (1): Foundable Ads can no longer run this campaign as it was approved, so it stopped. Nothing m
- **managed_late** (1): This campaign couldn't start in time: more than half its days had passed before Facebook w
- **managed_leads** (1): Foundable couldn't turn on counting sign-ups and inquiries on your website, so this campai
- **managed_lost** (1): Facebook hasn't confirmed this campaign yet. Run asks again for a day, then holds it and r
- **managed_page** (1): Foundable Ads is full right now: Facebook limits how many ads can run at once on the Page 
- **managed_plan** (1): Your plan no longer includes Foundable Ads, so this campaign stopped. What it didn't spend
- **managed_refused** (1): Facebook couldn't create this campaign, so nothing runs. Your reserved ad money was return
- **managed_removed** (1): This campaign was removed at Facebook outside Foundable, so it stopped. Nothing more spend
- **managed_stopped** (1): This campaign stopped before it started, so nothing spent. Your reserved ad money is back.
- **managed_uncertain** (1): Facebook didn't confirm this campaign. It's held and never sent again; nothing spends, and
- **managed_video** (1): Your video is being made ready for Facebook, which takes a few minutes; nothing spends unt
- **managed_waiting** (1): Facebook is busy with other campaigns, so this one is waiting its turn and goes out in a f
- **managed_wallet** (1): Your ad money went on hold, so this campaign stopped. What it didn't spend goes back to yo

### meta

- **meta_ai** (1): Meta AI

### metro

- **metro_area** (1): metro

### narration

- **narration_long** (1): narration
- **narration_markup** (1): narration
- **narration_missing** (1): narration
- **narration_unsupported** (1): narration

### needs

- **needs_response** (1): attention

### network

- **network_blocked** (1): outside

### no

- **no_credits** (1): You have no credits left. See your plan in Settings to keep building.

### not

- **not_capturable** (1): run_asset_capture_not_capturable
- **not_found** (1): not_found
- **not_live** (1): It is no longer live there, so there was nothing to take down.
- **not_now** (1): Ted was still working on another task in this foundable.

### opt

- **opt_out** (1): localStorage

### other

- **other_database** (1): Publishing refused this version: its code names a Supabase project other than this website

### owner

- **owner_only** (1): Only the owner of this business can do this.

### page

- **page_handles** (1): yes

### past

- **past_due** (1): attention

### payload

- **payload_too** (1): payload_too_large

### payment

- **payment_required** (1): billing

### payments

- **payments_setup** (1): payments_setup_plan_required

### persistence

- **persistence_name** (1): 

### person

- **person_profiles** (1): identified_only

### phone

- **phone_form** (10): This country asks who the number is for before it gives one. Fill it in, and your number c | The form couldn’t be opened. Try again. | Fill in the form
- **phone_country** (5): Choose another country | A form first, then 1 to 3 business days | {{country}} asks for a form about your business before it gives a local number. Your numbe
- **phone_your** (5): Your cell | That doesn’t look like a phone number. | Optional
- **phone_line** (1): phone_line_plan_required
- **phone_number** (1): Your number is ready
- **phone_text** (1): Your Text Ted phone

### place

- **place_search** (1): Search

### post

- **post_pending** (1): Confirmation is pending. Do not send this post again.
- **post_performance** (1): reading

### product

- **product_assets** (1): reading
- **product_in** (1): run_asset_product_in_use

### profile

- **profile_chunk** (1): profile

### propose

- **propose_brief** (1): writing
- **propose_business** (1): propose_foundable

### provider

- **provider_action** (1): social_change

### quiet

- **quiet_hours** (1): Quiet hours take off, or a start and an end as HH:MM-HH:MM.

### rate

- **rate_limited** (1): rate_limited

### raw

- **raw_security** (1): security

### read

- **read_guide** (1): reading
- **read_mail** (1): outreach
- **read_page** (1): reading

### recency

- **recency_range** (3): {{from}} to {{to}} | today | yesterday
- **recency_day** (1): {{day}} at {{clock}}
- **recency_older** (1): Older
- **recency_previous** (1): Previous 7 days
- **recency_today** (1): Today
- **recency_yesterday** (1): Yesterday

### reference

- **reference_unavailable** (1): The selected reference is unavailable. Choose it again.

### refused

- **refused_because** (1): {network} refused this ad: {reason}. Nothing was created and nothing spends. Change it and

### replay

- **replay_event** (1): replay
- **replay_recording** (1): replay

### reply

- **reply_busy** (1): The network was busy, so this reply was not sent.
- **reply_unconfirmed** (1): Provider confirmation is unavailable. Do not send this reply again.

### requires

- **requires_action** (1): attention

### rr

- **rr_type** (1): HTMLImageElement

### run

- **run_ad** (341): Open in {{manager}} | Approve | Approving creates this ad at {{network}}, paused. {{network}} reviews it, and nothing spen
- **run_post** (197): Action content | All metrics | Ted now posts as {{name}} on LinkedIn.
- **run_managed** (101): Add {{amount}} to run this ad | Run again | Due today
- **run_ads** (79): Account ID {{number}} | Ad account | Advertiser account
- **run_native** (69): {{place}} ad preview | Promoted | Promoted by {{name}}
- **run_review** (65): Approve | Approving | Ted has had a lot of asks just now. Try again in a minute.
- **run_asset** (49): Added {{ago}} | The page looked blank or broken, so nothing was kept. | Capturing the pages…
- **run_pref** (48): Audio | No audio | With audio
- **run_social** (45): {{account}} is no longer in use. | Posts that were also going to other accounts won’t go out there either. | {{account}} is no longer in use, and its scheduled post was cancelled.
- **run_search** (41): Open in Google Ads | Approving creates this ad at Google, paused. Google reviews it, and nothing spends yet. | Advertise on Google
- **run_library** (40): Assets | {{count}} document | {{count}} documents
- **run_email** (32): Use a domain you own | Like yourbusiness.com | {{domain}}, your website’s domain
- **run_tiktok** (31): Posting to {{name}} on TikTok | Allow | Branded content
- **run_cap** (21): Post replies for me | Ted’s replies go up without waiting for your OK | Reply to emails
- **run_files** (21): Actions for {{name}} | “{{name}}” was already deleted. | “{{name}}” changed just now, so it wasn’t deleted.
- **run_task** (20): Cancel this task | Done | +{{count}} more
- **run_tour** (17): {{run}} tour | These are my apps. Each one is a kind of work: research, email, social posts, your website | Close tour
- **run_video** (15): Add to website | Make my video “{{title}}” again as a wide video for my website. | Make my video “{{title}}” again as a wide {{maker}} video for my website.
- **run_answer** (14): I’ve added it | I sign in another way | I’ve connected it
- **run_stack** (14): Also holding {{run}} | Changed | Changed since you saw it
- **run_failure** (13): An account it was going to was turned off before it went out, so it wasn’t sent. | The network was busy. This post goes out again shortly on its own. | The network stayed busy for a day, so this post wasn’t sent. Post a new draft to send it.
- **run_number** (13): The number couldn’t be bought. Try again. | Country | Your WhatsApp number couldn’t be loaded.
- **run_reply** (12): Send the reply | Reply on {{network}} | Declined
- **run_made** (11): {{count}} thing Ted made for you | {{count}} things Ted made for you | Everything Ted has made, from every run, is in your {{library}}.
- **run_plan** (11): Build it | Check it works | {{done}} of {{total}}
- **run_waiting** (11): an ad | {{count}} ads | where I go next
- **run_channel** (9): {{channel}} accounts | Blog | Bugs
- **run_ask** (8): Your changes are saved, but your website isn’t live yet. Put it live and Ted will carry on | “{{website}}” isn’t live yet, so no one can see what Ted built. Publishing it takes “{{cur | Your website has saved changes that aren’t live yet. Publish them, or discard them, so Ted
- **run_connect** (8): Connect | Connect {{channel}} before Ted can use it. | Connect {{channel}}
- **run_next** (8): Make your ads | Answer your customers’ messages | Find new customers and email them
- **run_session** (8): Billing needs attention before {{run}} can start. | Ted couldn’t get started. Try again. | You’re out of credits. See your plan in Settings to start {{run}}.
- **run_take** (8): Ted asks to take this down | Take down | Taken down {{when}}
- **run_google** (7): Google didn’t share an ad account that can run ads. Reconnect and pick one, or fix it in G | Google Ads connected. Now choose your Google Ads account. | Search ads run from {{account}}, billed in {{currency}}.
- **run_page** (7): Ted now posts to {{page}} on Facebook. | Choose the Facebook Page Ted posts to. Not in the list? Press Reconnect, choose “Edit prev | The Page didn’t change. Try again.
- **run_list** (6): Couldn’t do it | Already met | Ted’s list
- **run_off** (6): Emails off | Everything off | Posts off
- **run_phone** (6): Customers call it, and Ted answers in his own voice. Each call shows up in your Inbox. | Goes through your calls | Sees who called and what they wanted, so he can follow up
- **run_power** (6): Power | credits | The smallest run is {{amount}} credits
- **run_schedule** (6): Coming up | Events | +{{count}} more
- **run_sent** (6): Sent with a file. Ted reads it next. | Sent with {{count}} files. Ted reads it next. | Sent: “{{text}}”. Ted reads it next.
- **run_account** (5): More actions | This account is also connected to {{businesses}}. | The provider has not confirmed the disconnect.
- **run_owner** (5): Put first | Leave out | What you told Ted
- **run_preview** (5): Connect this account before Ted can use it. Connection is unavailable in this local previe | Ted stops posting and replying on {{channel}}. You can reconnect anytime. | Preview only. This does not disconnect a real account.
- **run_tool** (5): Videos | Image | Schedule
- **run_activity** (4): Couldn’t load Ted’s activity. | {{run}} activity | Nothing yet
- **run_add** (4): Add an item to {{run}} before resuming. | Add an item to {{run}} before starting. | Add login
- **run_call** (4): End | Keypad | Mute
- **run_choices** (4): Your {{run}} choices could not be loaded. | Loading your {{run}} choices… | Retry loading your {{run}} choices before resuming.
- **run_ending** (4): I used the budget you set. | I finished what I set out to do. | You’re out of credits.
- **run_free** (4): Free run | Ted finishes this on his own. | Your first run is on us. Make your plan with Ted first.
- **run_hint** (4): Add it with +… | Paste the link… | Or tell him…
- **run_maker** (4): AI videos | New videos from your words or photos. | Movie-like scenes, with the lighting and camera moves of a film.
- **run_mode** (4): Ask first | You approve the emails, posts and website changes Ted makes without being asked | Ted sends and publishes himself, asking only for access
- **run_stop** (4): Stop {{run}} | Stop | Stop using
- **run_box** (3): Ted will ask here when he needs you | In {{run}} | Not in {{run}}
- **run_disconnect** (3): Disconnect | Disconnect account | Disconnect {{account}} from {{run}}? You can reconnect anytime.
- **run_facebook** (3): Facebook Page | Open {{page}} on Facebook | Ted posts to your business’s Facebook Page. Facebook doesn’t let him post to your personal
- **run_group** (3): Ads | Outreach | Social
- **run_keep** (3): Keep going | Keep it | Keep it out of chat
- **run_loading** (3): Loading {{run}}… | Loading your {{channel}} accounts… | Loading earlier activity…
- **run_not** (3): Not connected | Not published | Not sent yet
- **run_pages** (3): Your Facebook Pages could not be loaded. | Loading your Facebook Pages… | Facebook lets Ted post only to this Page for now. To add another, press Reconnect, choose 
- **run_quality** (3): Ted at full power, with his deepest research and smartest decisions | Deeper research, smarter decisions, stronger posts | Ted’s everyday work
- **run_quiet** (3): Taking notes | Reading | Getting ready
- **run_research** (3): Research | Ted hasn’t looked anything up yet | What he searches for and reads online shows up here.
- **run_start** (3): Start {{run}} | Start your free run | What I’ll do in {{run}}
- **run_status** (3): {{run}} paused | Ready to run | Ted is working
- **run_ted** (3): Ted’s activity | What Ted does without being asked | Ted needs you
- **run_tier** (3): Run Ultra | Run | Run Lite
- **run_use** (3): Use a different account | Use in {{run}} | Use this account
- **run_aim** (2): Writing a first email to a possible customer | Checking out your competition
- **run_apps** (2): Apps | Apps & settings
- **run_available** (2): {{amount}} credit available | {{amount}} credits available
- **run_browser** (2): Ted hasn’t used his browser yet | You can see his browsing history here once he uses it.
- **run_businesses** (2): {{count}} business | {{count}} businesses
- **run_drag** (2): Add an app using +, or drag it here | Remove an app using −, or drag it here
- **run_full** (2): Open full screen | Exit full screen
- **run_help** (2): Need help? | Need help with {{run}}
- **run_live** (2): Live · {{count}} change | Live · {{count}} changes
- **run_messages** (2): No messages yet | DMs from these apps show up here.
- **run_open** (2): Open Library | Open {{place}}
- **run_pace** (2): No limit | Choose a whole number from {{min}} to {{max}}.
- **run_pause** (2): Pause {{run}} | Pause
- **run_resume** (2): Resume {{run}} | Resume
- **run_runs** (2): No runs yet | Each run Ted does lands here, with its summary.
- **run_save** (2): Save limit | Save preferences
- **run_sources** (2): {{count}} source | {{count}} sources
- **run_tab** (2): Activity | Made
- **run_accounts** (1): Your {{channel}} accounts could not be loaded.
- **run_admin** (1): Only the owner or an admin can start or stop {{run}}.
- **run_already** (1): Already live
- **run_approval** (1): Approval
- **run_back** (1): Back to {{name}}
- **run_cancelled** (1): Cancelled
- **run_canvas** (1): {{run}} canvas
- **run_card** (1): asked
- **run_change** (1): Change Page
- **run_close** (1): Close panel
- **run_coming** (1): Coming soon
- **run_competitor** (1): Competitor snapshot
- **run_connected** (1): Connected
- **run_connecting** (1): Connecting {{channel}} is not available in {{run}} yet.
- **run_continue** (1): Continue your free run
- **run_controls** (1): {{run}} controls
- **run_credit** (1): Credit limit
- **run_custom** (1): Custom limit
- **run_defaults** (1): Defaults
- **run_denied** (1): Denied
- **run_dock** (1): Resize the dock
- **run_end** (1): End free run
- **run_foundable** (1): Foundable Ads
- **run_go** (1): Go to {{place}}
- **run_going** (1): Going live
- **run_history** (1): Couldn’t load more history.
- **run_how** (1): How Ted runs
- **run_kept** (1): Kept back · visitors would see it
- **run_limit** (1): {{amount}} credits
- **run_load** (1): Load earlier activity
- **run_looks** (1): Looks like a key.
- **run_manage** (1): Manage {{channel}}
- **run_max** (1): run_max_plan_required
- **run_name** (1): {{name}} is coming soon.
- **run_needs** (1): Needs your OK
- **run_network** (1): This network cannot be connected yet.
- **run_no** (1): No longer on {{network}}
- **run_paused** (1): Paused until you decide {{items}}.
- **run_pick** (1): Pick where Ted goes next to keep him going.
- **run_piece** (1): Results
- **run_premium** (1): run_premium_plan_required
- **run_published** (1): Published
- **run_publishing** (1): Publishing
- **run_reconnect** (1): Reconnect
- **run_remove** (1): Remove {{channel}} from {{run}}
- **run_removed** (1): Removed
- **run_replaced** (1): Replaced
- **run_saved** (1): Saved. Ted starts with this in {{run}}.
- **run_scheduled** (1): Scheduled
- **run_script** (1): library
- **run_secret** (1): Add it in your website’s {{build}} › Tools › {{security}} secrets. Never paste a key here.
- **run_send** (1): Send anyway
- **run_seo** (1): Ted keeps your business listed where people and AI assistants look for businesses like you
- **run_setting** (1): Setting up your\xA0business
- **run_settings** (1): {{run}} settings
- **run_shown** (1): Ted made this for you
- **run_site** (1): Ted can work on your website each pass and make new pages and websites for you. When {{run
- **run_switch** (1): A post already on its way may still go out.
- **run_switched** (1): Ted turned this off {{when}} because you said: “{{words}}”
- **run_taken** (1): Taken down
- **run_tools** (1): {{run}} tools
- **run_turn** (1): Choose your {{networks}} account
- **run_undoing** (1): Undoing
- **run_undone** (1): Undone
- **run_videos** (1): Choose the shape and audio for the videos Ted makes without being asked.
- **run_waits** (1): Waits for approval
- **run_workshop** (1): Ted’s workshop

### sandbox

- **sandbox_failed** (1): Build could not get ready for this request. Nothing was saved.

### save

- **save_mail** (1): outreach
- **save_web** (1): research

### schedule

- **schedule_meeting** (28): Event | Added by Ted | Close event
- **schedule_emails** (22): It was sending from {{from}}. New emails now go from {{now}}, so they wait for your OK. | Send these automatically | This task changed. Look at it again before you decide.
- **schedule_event** (17): Event | a reply | App event
- **schedule_route** (16): Ted saw nothing to do | Quick reply | sent automatically
- **schedule_run** (14): Together, at set times | As each one arrives | {{count}} goes at {{time}}
- **schedule_when** (13): When {{app}}: {{event}} | When an event is added to {{app}} | When a message is posted in a {{app}} channel
- **schedule_digest** (12): with the {{app}} events ({{event}}) since its last run | with the events added to {{app}} since its last run | with the messages posted in {{app}} channels since its last run
- **schedule_enter** (9): Enter an amount, such as 50 or 49.99. | Enter a currency code, such as USD. | Enter a valid date.
- **schedule_repeats** (8): Repeats {{every}} {{hours}}, {{days}} | Repeats daily | Repeats {{every}}
- **schedule_row** (8): At {{time}}, {{days}} | daily | every {{days}}
- **schedule_every** (7): Every | every hour | every {{count}} hour
- **schedule_no** (7): No events yet. | The request did not return a result. | This task has not run yet.
- **schedule_repeat** (7): Repeat | Custom | Daily
- **schedule_rule** (7): Monday | Tuesday | Wednesday
- **schedule_skip** (7): The app’s connection stopped working | Missed while Foundable was down | No credits left
- **schedule_calendar** (6): Calendar | Calendar date | Couldn’t load the calendar.
- **schedule_choose** (6): Choose an app | Choose an app and its event. | Choose a day from {{minimum}} to {{maximum}}.
- **schedule_new** (6): New | New from Ted | What to add
- **schedule_refused** (6): This business is not available for this account. | You’re out of credits. See your plan in Settings to run this task. | Scheduled tasks are not available for this business.
- **schedule_span** (6): all day | from {{start}} | from {{start}} to {{end}}
- **schedule_summary** (6): Ted does this every day, at {{time}}. | Ted does this {{every}} {{hours}}, {{days}}. | Ted does this on the {{day}} of every month, at {{time}}.
- **schedule_ignored** (5): Didn’t match what the task watches for | Not an event this task takes | Its details couldn’t be read
- **schedule_loading** (5): Loading calendar… | Loading events… | Loading older events…
- **schedule_next** (5): Next day | Next month | Next: {{when}}
- **schedule_time** (5): Time | {{start}} to {{end}} | Time zone
- **schedule_days** (4): Days | every day | on {{days}}
- **schedule_discard** (4): Discard changes | Discard changes confirmation | Are you sure you want to discard your changes?
- **schedule_period** (4): Day | Month | Week
- **schedule_previous** (4): Previous day | Previous month | Previous week
- **schedule_resume** (4): Only the owner can resume this task. | Only the owner or an admin can resume this task. | Resume requested. Waiting for updated task details.
- **schedule_show** (4): Show all | Show {{count}} more event on {{day}} | Show {{count}} more events on {{day}}
- **schedule_source** (4): Something happens in an app | An email arrives | A sale is paid
- **schedule_status** (4): Failed | Starting | Skipped
- **schedule_all** (3): all-day | all day | All tasks
- **schedule_charged** (3): Credits: {{route}} to read it, {{reply}} to reply | Credits: {{reply}} to reply | Credits: {{route}} to read it
- **schedule_delete** (3): Delete task confirmation | Are you sure you want to delete this task? | Delete task
- **schedule_events** (3): Events | This task’s events could not be loaded. | Events on {{day}}
- **schedule_from** (3): From | Anyone | These addresses
- **schedule_task** (3): Task | This task is still loading. Open it again in a moment. | This task is no longer available.
- **schedule_addresses** (2): Addresses | name@example.com, …
- **schedule_app** (2): App | App event
- **schedule_date** (2): Date | Date & time
- **schedule_frequency** (2): Frequency | Hourly
- **schedule_instructions** (2): Instructions | Instructions for Ted
- **schedule_kind** (2): Event | Task
- **schedule_pause** (2): Pause requested. Waiting for updated task details. | Pause task
- **schedule_paused** (2): Paused | paused
- **schedule_read** (2): Read only | This recurrence is read-only. Choose an available repeat option to change it.
- **schedule_retry** (2): The retry was rejected, but the original result is still unknown. {{message}} | Retry request
- **schedule_runs** (2): Runs | This task’s runs could not be loaded.
- **schedule_set** (2): Set up by Ted | Set up by Ted during your run
- **schedule_start** (2): Running tasks is not available here yet. | The task may have started. Check its recent runs before starting it again.
- **schedule_starts** (2): Starts | Starts
- **schedule_unit** (2): Hours | Minutes
- **schedule_what** (2): What happens | What happens
- **schedule_add** (1): Add
- **schedule_amount** (1): Amount
- **schedule_at** (1): At a time
- **schedule_back** (1): Back to {{place}}
- **schedule_clock** (1): Scheduled times don’t start tasks yet; start one with Run now.
- **schedule_close** (1): Close task
- **schedule_connection** (1): The connection was lost.
- **schedule_continues** (1): Continues
- **schedule_currency** (1): Currency
- **schedule_day** (1): Day of the month
- **schedule_deleting** (1): Deleting task…
- **schedule_edit** (1): Edit task
- **schedule_interval** (1): Interval unit
- **schedule_keep** (1): Keep editing
- **schedule_last** (1): Ted’s last reply
- **schedule_more** (1): +{{number}}<more> more</more>
- **schedule_older** (1): Older events could not be loaded.
- **schedule_options** (1): Options
- **schedule_pending** (1): {{status}} Closing this window does not cancel the request.
- **schedule_preview** (1): Preview only. Changes stay here; tasks won’t run.
- **schedule_recent** (1): Recent runs
- **schedule_replies** (1): Only replies to your emails
- **schedule_sale** (1): Only sales of at least
- **schedule_saving** (1): Saving task…
- **schedule_scheduled** (1): Scheduled tasks
- **schedule_started** (1): Started. Ted’s reply appears here once he answers.
- **schedule_starting** (1): Starting the task…
- **schedule_tasks** (1): Couldn’t load your scheduled tasks.
- **schedule_through** (1): Through the day
- **schedule_title** (1): Title
- **schedule_tomorrow** (1): Tomorrow
- **schedule_unconfirmed** (1): The server did not confirm the change.
- **schedule_unknown** (1): The result is still unknown. Retry the same request before making another change.
- **schedule_until** (1): Until
- **schedule_updating** (1): Updating task status…

### screen

- **screen_authoring** (1): Building the screen.
- **screen_preparing** (1): Choosing a style for your screen.
- **screen_writing** (1): Writing the screen.

### send

- **send_email** (1): writing
- **send_reply** (1): writing

### sentry

- **sentry_version** (1): 7

### session

- **session_changed** (1): session_changed

### settings

- **settings_paywall** (232): Pro is {{price}} a month. Then you pay the ad’s {{amount}} and it runs. | Run your ad with Pro | Add credits now.
- **settings_integrations** (187): Google didn’t share {{name}} with Foundable. On Google’s page, tick every box, then press  | Records in your bases | database databases table tables
- **settings_team** (134): Actions for {{name}} | {{name}} can use this business again. | Up to {{limit}} at a time, separated by commas or spaces.
- **settings_billing** (116): All activity in your account’s credit pool. Unused daily free credits don’t carry over. | Couldn’t load credit activity. | Loading credit activity…
- **settings_vault** (99): Accounts | Add login | Ted signs in with it without ever seeing it.
- **settings_domains** (59): Active | Ask Ted for ideas | Auto-renew
- **settings_account** (50): Add your name | Any paid plan stops now | Change photo
- **settings_proposal** (46): Changed from your reply: {{changes}}. You can change it back in Settings. | Decline | Declined. Nothing changed.
- **settings_assistants** (44): Add to {{assistant}} | Foundable’s address | Approve what he’s drafted for you
- **settings_earn** (36): credit earned | credits earned | Each friend counts once and must be a real person. You earn credits for up to {{count}} fr
- **settings_notifications** (36): All emails from Ted | Off stops every email about your business. Sign-in codes and billing emails still arrive. | Daily Updates
- **settings_logo** (26): Business logo | Change logo | Crop your logo
- **settings_general** (21): Currency | Your Store and checkout sell in it. Changing it doesn’t convert prices, and a published we | Delete business
- **settings_promo** (19): Credit added to your account | Credits added to your account | You’ve already redeemed this code.
- **settings_privacy** (16): All legal documents | DPA, DMCA, cookies, and more. | Email <mail>{{address}}</mail> and we’ll send it to you.
- **settings_preview** (11): Account deletion preview complete. No account or business was deleted. | Deletion confirmed in this preview only. No business or data was deleted. | Business details saved in this preview only.
- **settings_picture** (9): This browser can’t open HEIC photos. Choose a JPEG or PNG, or use Safari. | Picture position: drag it, or move it with the arrow keys | Choose a PNG, JPEG, WebP, HEIC or SVG picture under 8 MB.
- **settings_credits** (8): Available credit balance | Loading credits… | <amount>{{amount}}</amount> credit left
- **settings_save** (6): Save changes | Updated elsewhere — reloaded | Could not save. Try again.
- **settings_own** (5): {{other}} is signed in, not {{address}}. | Send from {{other}} | Sign in again
- **settings_checkout** (4): Pay on Stripe’s page | Secure checkout | Still opening checkout. On a slow connection this can take a little while.
- **settings_plan** (3): Free | Free Pro | No plan
- **settings_value** (3): Not set | Off | On
- **settings_copy** (2): Copy link | for {{name}}
- **settings_link** (2): Link copied | Couldn’t copy. The link is selected: copy it from the field.
- **settings_no** (2): Create your first business to edit its details here. | No business yet
- **settings_close** (1): Close {{title}}
- **settings_currency** (1): Automatic
- **settings_delete** (1): Before deleting, stop your ads in Foundable Ads and contact support to settle your ad mone
- **settings_email** (1): Email
- **settings_load** (1): Couldn’t load these settings.
- **settings_loading** (1): Loading your settings…
- **settings_nav** (1): Settings sections
- **settings_signed** (1): <signIn>Sign in</signIn> or <signUp>create an account</signUp>.
- **settings_unavailable** (1): Settings aren’t available right now
- **settings_unsaved** (1): Unsaved changes
- **settings_zone** (1): Automatic

### shell

- **shell_opening** (6): Opening… | Opening your conversation… | Opening your mail…
- **shell_choose** (5): Choose a business | Choose a business to see its mail. | Choose a business to see its schedule.
- **shell_view** (5): This view could not be loaded. | View only | View only: You can see this business, but not change it or ask Ted for work
- **shell_create** (4): Create your first business | Create business | Run a second business
- **shell_new** (4): New chat | New business | {{count}} new task from Ted
- **shell_ted** (4): Ted chat | Ted needs you | Ted replied
- **shell_chat** (3): Chat | Chat hidden | Chat history
- **shell_close** (3): Close | Close {{name}} | Close Tutorial hub
- **shell_limit** (3): The Free plan holds {{count}} business. Upgrade to start another. | The Free plan holds {{count}} businesses. Upgrade to start another. | You’ve reached your plan’s business limit.
- **shell_newsletter** (3): Send to subscribers | Sending… | Sent
- **shell_retry** (3): Retry | Retry chat | Retry businesses
- **shell_sign** (3): Sign in to see your mail. | Sign in to see your schedule. | Sign in to talk to Ted.
- **shell_start** (3): Start your new business | Start over with a new idea | Replaces {{name}}
- **shell_switch** (3): Switch business | Switch or add another Foundable | Switch, add another Foundable or start over
- **shell_continue** (2): Continue building | Continue to {{place}}
- **shell_foundables** (2): Your businesses could not be loaded. Try again. | Your businesses could not be loaded.
- **shell_invite** (2): Invite people | Invite your team
- **shell_loading** (2): Loading your businesses… | Loading your business…
- **shell_more** (2): More | More tools
- **shell_open** (2): Open {{name}} | Open Text Ted
- **shell_preview** (2): Preview businesses | This preview uses one server-bound business. Company switching is not connected.
- **shell_schedule** (2): {{place}} · {{count}} new task from Ted | {{place}} · {{count}} new tasks from Ted
- **shell_your** (2): Your businesses | Your website
- **shell_account** (1): Account menu
- **shell_back** (1): Back to {{name}}
- **shell_checking** (1): Checking whether the business was deleted…
- **shell_connected** (1): Connected
- **shell_contact** (1): Talk to us · new reply
- **shell_deleting** (1): Deleting this business…
- **shell_deletion** (1): Deletion is not confirmed yet
- **shell_foundable** (1): This business is on another account.
- **shell_get** (1): Get a phone number
- **shell_getting** (1): Getting Ted ready…
- **shell_go** (1): Go to {{place}}
- **shell_hide** (1): Hide chat
- **shell_inbox** (1): {{place}} · unread messages
- **shell_keep** (1): I’ll keep checking.
- **shell_layout** (1): Layout example
- **shell_lets** (1): Let’s build
- **shell_main** (1): Main navigation
- **shell_no** (1): You do not have a business yet.
- **shell_pixels** (1): {{width}} pixels
- **shell_profile** (1): Profile menu
- **shell_reconnecting** (1): Reconnecting…
- **shell_refresh** (1): Refresh to reconnect
- **shell_reload** (1): Reload
- **shell_resize** (1): Resize Ted chat
- **shell_run** (1): Run your ad
- **shell_saved** (1): Your saved conversation could not be opened.
- **shell_search** (1): Search could not be loaded.
- **shell_show** (1): Show chat
- **shell_support** (1): Talk to us
- **shell_switching** (1): Switching business…
- **shell_text** (1): Text Ted
- **shell_try** (1): Try again
- **shell_turn** (1): Turn on Build Ultra
- **shell_unread** (1): Unread messages
- **shell_use** (1): Use another account
- **shell_you** (1): You

### shot

- **shot_product** (2): timing | timing
- **shot_end** (1): timing

### site

- **site_landing** (83): Ted asks first: he waits for your OK before anything goes public. You can let him run on h | No. Tell Ted what you want in your own words, in chat or by text, and he builds it. You ne | You can start free. <link>Paid plans</link> add monthly credits, your own domain, taking p
- **site_link** (30): About | Ads | Blog
- **site_footer** (5): Footer | Company | Foundable elsewhere
- **site_ideas** (4): Ideas | Kinds of business | No idea matches “{{query}}”.
- **site_post** (4): Post | About this post | Published <time>{{date}}</time>
- **site_apps** (3): Filter apps | Kinds of app | No app matches “{{query}}”.
- **site_tab** (3): Product | Resources | Solutions
- **site_blog** (2): Posts | Show
- **site_all** (1): All
- **site_badge** (1): site_badge_plan_required
- **site_breadcrumb** (1): Breadcrumb
- **site_custom** (1): site_custom_domain_plan_required
- **site_language** (1): Language
- **site_log** (1): Log in
- **site_menu** (1): Menu
- **site_opening** (1): Opening…
- **site_skip** (1): Skip to content
- **site_start** (1): Start free

### social

- **social_connections** (1): social_connect_plan_required
- **social_inbox** (1): reading
- **social_posts** (1): searching

### source

- **source_cannot** (1): This saved version can't support that feature. Nothing was changed. Open the website's cur
- **source_invalid** (1): Build stopped: its changed files could not be saved. Nothing was saved.
- **source_unavailable** (1): This saved version can't support that feature. Nothing was changed.

### starting

- **starting_again** (1): Build is starting again.

### step

- **step_checking** (1): Running the checks.
- **step_database** (1): Setting up where your website saves its data.
- **step_fixing** (1): Fixing what the checks found.
- **step_looking** (1): Looking over the page.
- **step_pictures** (1): Drawing pictures for the page.
- **step_polishing** (1): Polishing the details.

### stopped

- **stopped_before** (1): Build stopped before starting. The last version is unchanged.

### storage

- **storage_unavailable** (1): run_asset_capture_storage_unavailable

### store

- **store_field** (20): City | Countries | Two-letter codes, such as US, CA
- **store_problem** (12): List each country by its two-letter code, such as US, CA. | Use a two-letter country code, such as US. | Give each variant a price, such as 12.00.
- **store_step** (10): Payments | Ready to take money. | Set it up so your shop can take money.
- **store_add** (5): Add a picture | Add product | Add a rate
- **store_no** (5): No ship-from address yet. | Add what you sell, with its price, stock and pictures. | No products yet
- **store_picture** (4): Picture {{number}} | Couldn’t add this picture. Try again. | Move picture {{number}} later
- **store_status** (4): Archived | Draft | On sale
- **store_stock** (4): {{number}} in stock | {{number}} in stock | Leave stock empty to sell without counting it, so it never sells out.
- **store_delete** (3): Delete zone | Buyers in its countries can no longer order until another zone covers them. | Delete {{name}}?
- **store_discard** (3): Discard changes | Your changes here aren’t saved yet. | Discard changes?
- **store_on** (3): Hidden from buyers. | Buyers can see it and buy it. | On sale: {{name}}
- **store_tab** (3): Store section | Products | Shipping
- **store_archive** (2): Archive | Couldn’t archive this product. Try again.
- **store_edit** (2): Edit product | Edit zone
- **store_new** (2): Add a product | Add a shipping zone
- **store_now** (2): {{name}} is no longer on sale. | {{name}} is on sale.
- **store_pictures** (2): Pictures | {{shown}} of {{max}}
- **store_read** (2): Couldn’t load your shop | Trying again…
- **store_remove** (2): Remove this rate | Remove this variant
- **store_save** (2): Couldn’t save this. Try again. | Your shop refused this change, so nothing changed. Check its web address and SKUs are each
- **store_saved** (2): Saved your address. | Saved your shipping.
- **store_ship** (2): Ship from | Ship-from address
- **store_adding** (1): Adding…
- **store_archived** (1): Archived {{name}}.
- **store_currency** (1): Set up Payments first, since prices are in your shop’s currency.
- **store_loading** (1): Loading your shop…
- **store_more** (1): More
- **store_next** (1): Open Payments
- **store_product** (1): Saved {{name}}.
- **store_rates** (1): Rates
- **store_standing** (1): Your shop is ready to sell.
- **store_steps** (1): What your shop needs to sell
- **store_variants** (1): Variants
- **store_zone** (1): No rates yet

### strict

- **strict_script** (1): fallback

### teammate

- **teammate_limit** (1): full

### time

- **time_zone** (1): That is not a time zone Foundable knows; use an IANA name such as Europe/Amsterdam.

### tools

- **tools_db** (315): Active filters | Couldn’t add a test user. Try again. | Add filter
- **tools_payments** (227): Active | To add a product, | ask Ted
- **tools_ai** (173): {{credits}} credit an answer | {{credits}} credits an answer | Answered
- **tools_security** (138): Advisory {{advisory}} | Access control & authorization | Couldn’t check database rules this time.
- **tools_logs** (63): Apply | Custom range… | Custom time range
- **tools_ref** (52): All examples | All styles | Close references
- **tools_secret** (46): Secret actions | Secret actions: {{name}} | Add secret
- **tools_orders** (43): Order actions: #{{number}} | Address copied | Carrier
- **tools_emails** (41): Couldn’t load emails | Loading emails… | {{sent}} of {{allowance}} emails this month
- **tools_offer** (41): Archived in your Stripe Dashboard. Switch it on to sell it again. | Ask Ted for another price. | Being created from your reply. It shows here once it is.
- **tools_connections** (33): Callback URL | Callback URL copied | Add it once to each provider’s app as its redirect URL. All your websites use this one.
- **tools_sample** (33): Access | {{setting}} is shown as sample configuration. Live access settings are not connected. | Add secret
- **tools_stripe** (29): Bank cannot process | Canceled | Check returned
- **tools_images** (26): Choose an image between 1 byte and {{size}} MiB. | Choose a PNG, JPEG or WebP image. | Not saved: your Files are full. Delete files you no longer need in the Library, under File
- **tools_preview** (24): What should change here? | Choose the new photo | Try describing it another way.
- **tools_viewing** (16): Adding… | Viewing as | Viewing as: {{who}}
- **tools_refund** (15): Showing the newest {{shown}} of {{total}}. Search above, or tell Ted the email or the day  | Not refunded. | Couldn’t load these sales.
- **tools_live** (11): Your live site is ready to open in test mode | Couldn’t open your live site in test mode. Try again. | Your website’s database isn’t ready yet, so your live site can’t sign you in.
- **tools_test** (11): Test checkout canceled | Open test checkout | Test purchase went through
- **tools_buyer** (10): We’re confirming your payment. | It can take a moment. | Your payment didn’t go through.
- **tools_no** (7): No website yet | Build a website to see what its AI answers and spends here. | Build a website to manage its data here.
- **tools_sale** (3): Paid | Partly refunded | Refunded
- **tools_files** (2): Files: {{kept}} kept · {{downloaded}} downloaded in {{days}} days · {{credits}} credit | Files: {{kept}} kept · {{downloaded}} downloaded in {{days}} days · {{credits}} credits
- **tools_websites** (2): Couldn’t load your websites | Loading your websites…
- **tools_codebase** (1): Couldn’t download. Try again.
- **tools_database** (1): View and manage the data stored in your website.
- **tools_heading** (1): Tools
- **tools_nav** (1): Build tools
- **tools_trying** (1): Trying again…

### trace

- **trace_metric** (1): metric

### under

- **under_review** (1): attention

### use

- **use_computer** (1): browser

### user

- **user_report** (1): default

### video

- **video_save** (2): Save video | Save video: {{title}}
- **video_share** (2): Share | Share: {{title}}
- **video_not** (1): Build stopped: it could not place the requested videos on the website. Nothing was saved.
- **video_ready** (1): Ready to save.

### warning

- **warning_needs** (1): attention
- **warning_under** (1): attention

### watch

- **watch_video** (1): research

### web

- **web_search** (1): searching

### website

- **website_copy** (4): Copying your pages. | Copying the look of your website. | Copying your website.
- **website_ai** (1): ai_models_plan_required
- **website_authoring** (1): Building the pages.
- **website_automation** (1): website_automation_plan_required
- **website_emails** (1): website_emails_plan_required
- **website_preparing** (1): Choosing a style for your website.
- **website_read** (1): reading
- **website_saving** (1): Saving your website.
- **website_unavailable** (1): The selected website is unavailable. Refresh it and try again.
- **website_verifying** (1): Checking your website.
- **website_writing** (1): Writing the page.

### workspace

- **workspace_exec** (1): library
