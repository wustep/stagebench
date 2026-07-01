# Stagebench persisted-data schemas

These Draft 2020-12 JSON Schemas are the public contracts for Stagebench protocol and result data. New protocol-v3 records must validate against the current schemas. Older records remain readable through optional legacy fields and are classified as `legacy`; they are not silently upgraded into the current comparison series.

Validate the protocol, run manifests, generated registry, evaluations, verifications, feature matrices, and implementation manifests with:

```sh
pnpm stagebench validate
```

Schema changes are comparison-critical and require a protocol release/version review.
