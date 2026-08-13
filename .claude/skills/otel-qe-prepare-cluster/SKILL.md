---
name: otel-qe-prepare-cluster
description: Provisions or connects to an OpenShift cluster for QE testing.
---

# Prepare QE Cluster

## Provision a cluster
If you're not already connected to an OpenShift cluster, you can either use:

* **local CRC (CodeReady Containers)**
* request an IBM P/Z cluster by emailing the IBM team from `/rhosdt-team:rhosdt-team` skill.
* request a cluster via Slack ClusterBot:

1. Open Slack and find **ClusterBot**
2. Click **Launch** under "CI Clusters"
3. Use these settings:
   - Platform: **AWS** (ROSA does not work because it doesn't support `ImageDigestMirrorSet`)
   - Architecture: **amd64**
   - Launch from PR: **No**
   - Stream: **4-stable**
   - Major.Minor: **4.20**
   - Version: **latest**
   - No extra parameters
4. Wait for the **a cluster is being created** in the dialog before closing it
5. Wait approximately **1 hour** for the cluster to be provisioned
6. ClusterBot will send you the kubeconfig/login credentials once the cluster is ready

## Get FBC fragment images from the Konflux repo
The user must provide the release version (e.g. 3.10.0). Use the `/gitlab` skill to fetch the FBC fragment images or OLM bundle from the Konflux release-payloads directory on GitLab.
Use the `/rhosdt-team:rhosdt-team` skill to get the release payload.

The FBC fragments work only on amd64 clusters, on arm64 clusters or IBM P/Z clusters the OLM bundle must be used.

If the files don't exist for the given version, ask the user for the correct version or the FBC fragment images directly.
