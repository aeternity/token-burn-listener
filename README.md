# Token Burn Listener

This is the token burn listener. It records `Burn` events into backendless service.


# Deployment

To build the image run
```
make docker-build
```

To deploy on AWS run
```
make docker-push-aws && make deploy-k8s-aws
```

To deploy on GCP run
```
make docker-push-gcp && make deploy-k8s-gcp
```

To deploy both AWS and GCP run
```
make docker-push-all && make deploy-k8s-all
```


