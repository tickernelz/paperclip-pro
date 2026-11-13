# Release notes: Speech-to-text providers

## What changes

- **Settings > General > Speech-to-text** gains a **Provider** choice: OpenAI-compatible (as before), Deepgram, ElevenLabs, or Google Cloud Speech-to-Text (v2, Chirp 3 by default). The base URL is optional for Deepgram and ElevenLabs and defaults to their public API origin; a regional origin such as `https://api.eu.deepgram.com` works.
- **Model** is a free-text field with suggestions. **Fetch** lists models from Deepgram (`GET /v1/models`, batch models only) or from the OpenAI-compatible endpoint (`GET /models`). ElevenLabs publishes no speech-to-text model list, so its suggestions are `scribe_v3`, `scribe_v2` and `scribe_v2_medical`.
- **Language**: empty detects the language; otherwise a code such as `id`, `en` or `pt-BR`, or `multi` for Deepgram Nova-3 multilingual.
- Deepgram and ElevenLabs options: **Speaker diarization** and **Keyterms**; Deepgram **Smart formatting**; ElevenLabs **Tag audio events** and **Maximum speakers**. Diarized transcripts with more than one speaker are written as `Speaker N: text` lines.
- Google: the key variable holds a service account JSON key or its file path; Wardmote signs a token request and caches the access token for its lifetime. Options: **Location** (`us` by default; Chirp 3 runs in `us` and `eu`), **Project id**, **Automatic punctuation**, diarization, keyterms as an inline phrase set, and up to two **Alternative languages** for the `long`, `short` and `telephony` models. Empty language uses Chirp's automatic detection. **Fetch** reads the models of the location from the Locations API. Google transcribes synchronously, so audio over 60 seconds or 7.5 MB is refused with `stt_too_long` or `stt_too_large`.
- **Test speech-to-text** transcribes an audio file you choose with the unsaved settings and shows the text or the `stt_*` error code.
- **Agents can transcribe attachments**: `POST /api/attachments/{attachmentId}/transcript` (MCP `wardmoteTranscribeAttachment`, extended toolset) transcribes any audio or video attachment the caller can read, including Telegram voice notes and task files. Each call is billed by the provider and nothing is stored.

## Compatibility

- A stored speech-to-text setting without `provider` reads as OpenAI-compatible and sends the same request as before; no migration or re-save is needed. OpenWA voice notes keep waiting at most `sttWaitSeconds`.
- The API key stays a server environment variable name (`apiKeyEnvVar`); its value, and for Google the service account key, is never stored, logged or returned.
- New error code `stt_invalid_credentials` (HTTP 503 on the transcript route) for a Google key that cannot be read or used.
- `GET`/`PATCH /api/instance/settings/general` returns and accepts the new `speechToText` keys: `provider`, `language`, `diarize`, `keyterms`, `deepgram.smartFormat`, `elevenlabs.tagAudioEvents`, `elevenlabs.numSpeakers`.
- **Max audio (seconds)** is enforced for Ogg Opus voice notes and for a caller's duration hint. An agent transcribing an mp3, m4a, wav or mp4 attachment is limited by bytes only (the instance attachment limit, or 7.5 MB for Google), so each call is billed by the provider for the full recording.
- The speech-to-text response size limit rises from 1 MB to 4 MB so that Deepgram's word timings for long audio fit.
