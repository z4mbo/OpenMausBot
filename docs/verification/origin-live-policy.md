# Origin Live calls use a personal key

The inherited phone-only subscription check is a P2 product-policy defect in Origin. A person with no OpenMaus subscription receives HTTP 402 before Origin can ask for their Live key. Origin has no matching plan to buy. Desktop and web calls already use the personal key directly.

The actual isolated HTTP regression has four phone/companion failures and three passing controls before the correction. All seven cases pass afterward. Six client/companion combinations exercise missing-key recovery, a configured synthetic key, provider session startup and hang-up. Cross-origin requests remain denied with 403, and an unknown bot remains 404 before provider contact. Call/config responses never expose the key.

Integration `c6371c2b4` selectively adapts the plan-gate removal from [upstream #3071](https://github.com/milind-soni/OpenMausBot/pull/3071), merge `411d86e69b18a726874cb0b18404293ca26d03d1`. It removes the server gate and renderer purchase prompt. An older connected server's subscription refusal becomes a server-update error. It does not introduce upstream's fallback from a general OpenAI key: calls still require the explicitly configured Live key. Desktop commercial bridge/relay removal has separate evidence.

The worker selection passes 283 tests across fourteen files, with one file/seventeen existing POSIX-only cases skipped on Windows. The new seven HTTP cases run on Windows. Application/server types, lint, documentation and size guards pass. [Retained logs, source bindings and limits](evidence/origin-live-policy-034/report.json) and the [hash manifest](evidence/origin-live-policy-034/manifest.json) distinguish this worker checkpoint from the later integrated suite and public delivery.

The fixture uses the standard isolated launcher and a loopback fake OpenAI service. There is no real key, provider bill, audio, physical phone, WebRTC media or production-data acceptance. This change removes a commercial gate; existing authentication, bot visibility, session revocation, approvals and provider-key requirements remain separate enforced checks.
