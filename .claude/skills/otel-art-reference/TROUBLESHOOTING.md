# Troubleshooting

## Registry access

- **`registry.stage.redhat.io`:** credentials are in the team's credential store. To check that an image is there: `skopeo inspect docker://registry.stage.redhat.io/rhosdt/opentelemetry-operator-bundle:<tag>`.
- **`brew.registry.redhat.io`:** needs the VPN and a Kerberos ticket. Create a token as described in the [brew registry docs](https://source.redhat.com/groups/public/teamnado/wiki/brew_registry), then `podman login brew.registry.redhat.io`.
- **`cosign`:** reads the Docker credentials, not the Podman ones. Point `DOCKER_CONFIG` at a directory with a `config.json` that has the registry.

To read the content that a production catalog has for the product:
```bash
podman cp "$(podman create --name tc registry.redhat.io/redhat/redhat-operator-index:v4.20)":/configs/opentelemetry-product opentelemetry-product-4.20; podman rm tc
```

## Query old objects and logs from cluster

Install KubeArchive `kubectl` plugin (`kubectl-ka`) https://konflux.pages.redhat.com/docs/users/faq/kubearchive.html

```bash
KA_HOST=$(oc get cm -n product-kubearchive kubearchive-api-url -o jsonpath='{.data.URL}')
kubectl ka config set host $KA_HOST
kubectl ka get pipelinerun
```
