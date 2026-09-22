# Security

The portable app is intended for use on the same computer through loopback. Do not expose local mode to the public internet. Saved API keys are private local files, not a hosted secret vault; protect the operating-system account and its backups.

Never include real keys, signed media URLs or private videos in public bug reports. For a suspected vulnerability, contact the repository owner privately or use GitHub private vulnerability reporting if available. Do not publish exploit details or credentials in a public issue.

Release checks must exclude environments, saved settings, databases, media and model caches from distributable archives. Dependency and model licenses need review. Unsigned preview executables are not publisher-verified; verify release checksums from the trusted release location.

Security reporting is not a promise of a response SLA. Public multi-user hosting requires a separate security and deployment review.
