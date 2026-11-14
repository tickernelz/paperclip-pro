# Release notes: Speech-to-text providers

## What changes

- **Settings > General > Speech-to-text** gains a **Provider** choice: OpenAI-compatible (as before), Deepgram, ElevenLabs, or Google Cloud Speech-to-Text (v2, Chirp 3 by default). The base URL is optional for Deepgram and ElevenLabs and defaults to their public API origin; a regional origin such as `https://api.eu.deepgram.com` works.
- The form needs no typing for Deepgram, ElevenLabs or Google: **Provider**, key status, **Model** and **Language** are dropdowns (language is searchable, **Automatic** first), the rest is under **Advanced**. Each provider's default key variable (`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `OPENAI_API_KEY`) is filled in and shown as set or not set; values never leave the server. Keyterms are chips, Google alternative languages a multi-pick, limits are steppers with a Default button.
- **Model** lists Wardmote's curated models; **Fetch** lists models from Deepgram (`GET /v1/models`, batch models only), the OpenAI-compatible endpoint (`GET /models`) or Google's Locations API (and Google's locations). ElevenLabs publishes no speech-to-text model list. **Other model...** allows a typed id.
- **Language**: Automatic, or a code from the provider's documentation, including `multi` for Deepgram Nova-3.
- Deepgram and ElevenLabs options: **Speaker diarization** and **Keyterms**; Deepgram **Smart formatting**; ElevenLabs **Tag audio events** and **Maximum speakers**. Diarized transcripts with more than one speaker are written as `Speaker N: text` lines.
- Google: the key variable holds a service account JSON key or its file path; Wardmote signs a token request and caches the access token for its lifetime. Options: **Location** (`us` by default; Chirp 3 runs in `us` and `eu`), **Project id**, **Automatic punctuation**, diarization, keyterms as an inline phrase set, and up to two **Alternative languages** for the `long`, `short` and `telephony` models. Empty language uses Chirp's automatic detection. **Fetch** reads the models of the location from the Locations API. Google transcribes synchronously (about 60 s per request); WhatsApp and Telegram voice notes (Ogg Opus) longer than 55 s are split at Ogg page boundaries and sent as several requests (each with its own 120 s deadline, at most three at once), so they no longer fail with `stt_too_long`. Other formats stay limited to 60 s and 7.5 MB on Google.
- Audio read from a stream (attachments in non-local storage) is spooled to a temporary file under the instance data directory and sent from there, then deleted.
- **Test speech-to-text** transcribes an audio file you choose with the unsaved settings and shows the text or the `stt_*` error code.
- **Every agent can transcribe attachments**: `POST /api/attachments/{attachmentId}/transcript` (MCP `wardmoteTranscribeAttachment`, core toolset; OpenAI Dot runner `transcribe_task_attachment`) transcribes any audio or video attachment the caller can read, including WhatsApp and Telegram voice notes and task files. Transcripts are cached per file content and transcript setting in instance storage, so each file is billed once.
- The OpenWA wake shows `transcriptUnavailable` with the `stt_*` code when a voice note could not be transcribed.

## Compatibility

- A stored speech-to-text setting without `provider` reads as OpenAI-compatible and sends the same request as before; no migration or re-save is needed. OpenWA voice notes keep waiting at most `sttWaitSeconds`.
- The API key is typed into **API key** next to **Provider** and saved encrypted per provider (`local_encrypted`); it is never returned, logged or written to the activity log. Without a saved key the server environment variable named in `apiKeyEnvVar` is read as before, so existing setups need no change.
- New error code `stt_invalid_credentials` (HTTP 503 on the transcript route) for a Google key that cannot be read or used.
- `GET`/`PATCH /api/instance/settings/general` returns and accepts the new `speechToText` keys: `provider`, `language`, `diarize`, `keyterms`, `deepgram.smartFormat`, `elevenlabs.tagAudioEvents`, `elevenlabs.numSpeakers`.
- **Max audio (seconds)** is enforced for Ogg Opus voice notes and for a caller's duration hint. An agent transcribing an mp3, m4a, wav or mp4 attachment is limited by bytes only (the instance attachment limit, or 7.5 MB for Google), so each call is billed by the provider for the full recording.
- The speech-to-text response size limit rises from 1 MB to 4 MB so that Deepgram's word timings for long audio fit.
