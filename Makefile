GIT_DESCR = $(shell git describe --always)
# build output folder
OUTPUTFOLDER = dist
# docker image
DOCKER_REGISTRY_AWS = 166568770115.dkr.ecr.eu-central-1.amazonaws.com/aeternity
DOCKER_REGISTRY_GCP = eu.gcr.io/aeternity-token-burn-listener/aeternity
DOCKER_IMAGE = token-burn-listener
K8S_DEPLOYMENT = token-burn-listener-production
DOCKER_TAG = $(shell git describe --always --tags)


.PHONY: list
list:
	@$(MAKE) -pRrq -f $(lastword $(MAKEFILE_LIST)) : 2>/dev/null | awk -v RS= -F: '/^# File/,/^# Finished Make data base/ {if ($$1 !~ "^[#.]") {print $$1}}' | sort | egrep -v -e '^[^[:alnum:]]' -e '^$@$$' | xargs

clean:
	@echo remove $(OUTPUTFOLDER) folder
	@rm -rf dist
	@echo done

build:
	@echo build release
	npm install && npm run build
	@echo done

docker-build:
	@echo build image
	docker build -t $(DOCKER_IMAGE) -f Dockerfile .
	@echo done

docker-push-all: docker-push-aws docker-push-gcp

docker-push-aws:
	@echo push image - aws
	docker tag $(DOCKER_IMAGE) $(DOCKER_REGISTRY_AWS)/$(DOCKER_IMAGE):$(DOCKER_TAG)
	aws ecr get-login --no-include-email --region eu-central-1 --profile aeternity-sdk | sh
	docker push $(DOCKER_REGISTRY_AWS)/$(DOCKER_IMAGE):$(DOCKER_TAG)
	@echo done

docker-push-gcp:
	@echo push image - gcp
	docker tag $(DOCKER_IMAGE) $(DOCKER_REGISTRY_GCP)/$(DOCKER_IMAGE):$(DOCKER_TAG)
	docker push $(DOCKER_REGISTRY_GCP)/$(DOCKER_IMAGE):$(DOCKER_TAG)
	@echo done

deploy-k8s-all: deploy-k8s-aws deploy-k8s-gcp

deploy-k8s-aws:
	@echo deploy k8s - aws
	kubectl patch deployment $(K8S_DEPLOYMENT) --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value":"$(DOCKER_REGISTRY_AWS)/$(DOCKER_IMAGE):$(DOCKER_TAG)"}]'
	@echo deploy k8s done

deploy-k8s-gcp:
	@echo deploy k8s - gcp
	kubectl patch deployment $(K8S_DEPLOYMENT) --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value":"$(DOCKER_REGISTRY_GCP)/$(DOCKER_IMAGE):$(DOCKER_TAG)"}]'
	@echo deploy k8s done

debug-start:
	npm install && npm run serve
