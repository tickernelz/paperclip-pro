# Release notes: Speech-to-text providers

## What changes

- **Settings > General > Speech-to-text** gains a **Provider** choice: OpenAI-compatible (as before), Deepgram, or ElevenLabs. The base URL is optional for Deepgram and ElevenLabs and defaults to their public API origin; a regional origin such as `https://api.eu.deepgram.com` works.
- **Model** is a free-text field with suggestions. **Fetch** lists models from Deepgram (`GET /v1/models`, batch models only) or from the OpenAI-compatible endpoint (`GET /models`). ElevenLabs publishes no speech-to-text model list, so its suggestions are `scribe_v3`, `scribe_v2` and `scribe_v2_medical`.
- **Language**: empty detects the language; otherwise a code such as `id`, `en` or `pt-BR`, or `multi` for Deepgram Nova-3 multilingual.
- Deepgram and ElevenLabs options: **Speaker diarization** and **Keyterms**; Deepgram **Smart formatting**; ElevenLabs **Tag audio events** and **Maximum speakers**. Diarized transcripts with more than one speaker are written as `Speaker N: text` lines.
- **Test speech-to-text** transcribes an audio file you choose with the unsaved settings and shows the text or the `stt_*` error code.
- **Agents can transcribe attachments**: `POST /api/attachments/{attachmentId}/transcript` (MCP `wardmoteTranscribeAttachment`, extended toolset) transcribes any audio or video attachment the caller can read, including Telegram voice notes and task files. Each call is billed by the provider and nothing is stored.

## Compatibility

- A stored speech-to-text setting without `provider` reads as OpenAI-compatible and sends the same request as before; no migration or re-save is needed. OpenWA voice notes keep waiting at most `sttWaitSeconds`.
- The API key stays a server environment variable name (`apiKeyEnvVar`); its value is never stored, logged or returned.
- `GET`/`PATCH /api/instance/settings/general` returns and accepts the new `speechToText` keys: `provider`, `language`, `diarize`, `keyterms`, `deepgram.smartFormat`, `elevenlabs.tagAudioEvents`, `elevenlabs.numSpeakers`.
- The speech-to-text response size limit rises from 1 MB to 4 MB so that Deepgram's word timings for long audio fit.
