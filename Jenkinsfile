def readJsonScalar(String fileName, String fieldPath) {
    return sh(
        returnStdout: true,
        script: "node -e 'const fs=require(\"fs\"); let value=JSON.parse(fs.readFileSync(process.argv[1],\"utf8\")); for (const part of process.argv[2].split(\".\")) value=value?.[part]; if (value !== null && value !== undefined) process.stdout.write(String(value));' '${fileName}' '${fieldPath}'"
    ).trim()
}

def readResolvedPlan(String fileName) {
    return [
        action: readJsonScalar(fileName, 'action'),
        mode: readJsonScalar(fileName, 'mode'),
        dryRun: readJsonScalar(fileName, 'dryRun') == 'true',
        target: [commit: readJsonScalar(fileName, 'target.commit')],
        targetIdentity: readJsonScalar(fileName, 'targetIdentity'),
        observedMainSha: readJsonScalar(fileName, 'observedMainSha'),
        observedIntegrationSha: readJsonScalar(fileName, 'observedIntegrationSha'),
        candidateSourceSha: readJsonScalar(fileName, 'candidateSourceSha'),
        firstRelease: readJsonScalar(fileName, 'firstRelease') == 'true',
        releaseRequired: readJsonScalar(fileName, 'releaseRequired') == 'true',
        releaseVersion: readJsonScalar(fileName, 'releaseVersion'),
        releaseTag: readJsonScalar(fileName, 'releaseTag'),
    ]
}

def checkoutCandidate(String stashName, String candidateRef) {
    deleteDir()
    unstash stashName
    if (isUnix()) {
        sh "git init . && git remote add origin git@github.com:YuryYudin/t3code.git && git fetch candidate.bundle ${candidateRef}:refs/remotes/fork-candidate && rm candidate.bundle && git checkout --detach refs/remotes/fork-candidate"
    } else {
        bat "git init . && git remote add origin git@github.com:YuryYudin/t3code.git && git fetch candidate.bundle ${candidateRef}:refs/remotes/fork-candidate && del /q candidate.bundle && git checkout --detach refs/remotes/fork-candidate"
    }
}

def installWorkspace() {
    if (isUnix()) {
        sh 'corepack pnpm install --frozen-lockfile'
    } else {
        bat 'corepack pnpm install --frozen-lockfile'
    }
}

def prepareCandidate(Map resolved, String slug) {
    def candidateRef = "refs/heads/fork-release/candidate-${slug}"
    node('built-in') {
        stage("${slug}: Prepare") {
            checkout scm
            sh 'git clean -fd'
            sh '''
                git remote remove upstream 2>/dev/null || true
                git remote add upstream https://github.com/pingdotgg/t3code.git
                git fetch --prune --tags upstream '+refs/heads/main:refs/remotes/upstream/main'
            '''
            withCredentials([string(credentialsId: 't3code-bootstrap-source-sha', variable: 'BOOTSTRAP_SOURCE_SHA')]) {
                sh "node scripts/fork-release.ts prepare --target ${resolved.target.commit} --source ${resolved.candidateSourceSha} --candidate-ref ${candidateRef} --first-release ${resolved.firstRelease} --bootstrap-source-sha \"\$BOOTSTRAP_SOURCE_SHA\""
            }
            sh "git bundle create candidate.bundle ${candidateRef}"
            stash name: "candidate-${slug}", includes: 'candidate.bundle'
        }
    }
    return candidateRef
}

def integrationArgs(Map resolved) {
    def kind = resolved.candidateKind ?: 'integration'
    def observed = kind == 'stable' ? resolved.observedMainSha : resolved.observedIntegrationSha
    return "--kind ${kind} --source ${resolved.candidateSourceSha} --target ${resolved.target.commit} --observed ${observed}"
}

def requestIntegrationRepair(Map resolved, String feedback = '') {
    node('built-in') {
        stage('Automatic integration repair') {
            checkout scm
            def feedbackArg = ''
            if (feedback) {
                unstash feedback
                feedbackArg = '--feedback .fork-quality.log'
            }
            withCredentials([
                string(credentialsId: 't3code-jenkins-token', variable: 'T3CODE_JENKINS_TOKEN'),
                string(credentialsId: 't3code-jenkins-base-url', variable: 'T3CODE_JENKINS_BASE_URL'),
                string(credentialsId: 't3code-jenkins-project-id', variable: 'T3CODE_JENKINS_PROJECT_ID'),
                string(credentialsId: 't3code-jenkins-model-selection', variable: 'T3CODE_JENKINS_MODEL_SELECTION'),
            ]) {
                sh "node scripts/fork-integration.ts request ${integrationArgs(resolved)} ${feedbackArg}"
            }
            timeout(time: 35, unit: 'MINUTES') {
                waitUntil(initialRecurrencePeriod: 5000, quiet: true) {
                    sh "node scripts/fork-integration.ts finish ${integrationArgs(resolved)} > .fork-integration.json"
                    return readJsonScalar('.fork-integration.json', 'status') != 'waiting'
                }
            }
        }
    }
}

def prepareIntegration(Map resolved, String slug) {
    def candidateRef = "refs/heads/fork-release/candidate-${slug}"
    def status
    def alreadyCurrent = false
    node('built-in') {
        checkout scm
        sh 'git clean -fd'
        sshagent(credentials: ['github-pockeo-ssh']) {
            sh "git fetch origin '+refs/heads/main:refs/remotes/origin/main' '+refs/heads/integration/upstream-main:refs/remotes/origin/integration/upstream-main'"
        }
        sh "node scripts/fork-integration.ts current ${integrationArgs(resolved)} > .fork-integration-current.json"
        if (resolved.candidateKind != 'stable' && readJsonScalar('.fork-integration-current.json', 'current') == 'true') {
            alreadyCurrent = true
            return
        }
        stage("${slug}: Prepare incremental merges") {
            sshagent(credentials: ['github-pockeo-ssh']) {
                sh "node scripts/fork-integration.ts prepare ${integrationArgs(resolved)} > .fork-integration.json"
            }
            status = readJsonScalar('.fork-integration.json', 'status')
        }
    }
    if (alreadyCurrent) return null
    while (status == 'needs-repair') {
        requestIntegrationRepair(resolved)
        node('built-in') {
            status = readJsonScalar('.fork-integration.json', 'status')
        }
    }
    ensureIntegrationBundle(resolved, slug, candidateRef)
    return candidateRef
}

def ensureIntegrationBundle(Map resolved, String slug, String candidateRef) {
    while (!bundleIntegration(resolved, slug, candidateRef)) {
        requestIntegrationRepair(resolved, "quality-feedback-${slug}")
    }
}

def bundleIntegration(Map resolved, String slug, String candidateRef) {
    def valid = false
    node('built-in') {
        checkout scm
        def status = sh(returnStatus: true, script: "node scripts/fork-integration.ts bundle ${integrationArgs(resolved)} --output '${env.WORKSPACE}/candidate.bundle' --ref ${candidateRef} > .fork-integration.json 2> .fork-quality.log")
        valid = status == 0
        if (valid) {
            stash name: "candidate-${slug}", includes: 'candidate.bundle'
        } else {
            echo 'Candidate guard failed; returning the recorded feedback to the repair worker.'
            stash name: "quality-feedback-${slug}", includes: '.fork-quality.log'
        }
    }
    return valid
}

def withWorkflowLock(Closure body) {
    def runId = "${env.JOB_NAME}#${env.BUILD_NUMBER}"
    def acquired = false
    try {
        while (!acquired) {
            def owner
            node('built-in') {
                checkout scm
                sh "mkdir -p '${env.FORK_RELEASE_STATE_DIR}'"
                sh "flock '${env.FORK_RELEASE_STATE_DIR}/workflow.guard' node scripts/fork-integration.ts lock --operation acquire --owner '${runId}' > .fork-lock.json"
                acquired = readJsonScalar('.fork-lock.json', 'acquired') == 'true'
                owner = readJsonScalar('.fork-lock.json', 'owner')
            }
            if (!acquired) {
                echo "Waiting for fork workflow owner ${owner}"
                waitForBuild runId: owner, propagate: false, propagateAbort: false
                node('built-in') {
                    sh "flock '${env.FORK_RELEASE_STATE_DIR}/workflow.guard' node scripts/fork-integration.ts lock --operation release --owner '${owner}'"
                }
            }
        }
        body()
    } finally {
        if (acquired) {
            node('built-in') {
                checkout scm
                sh "flock '${env.FORK_RELEASE_STATE_DIR}/workflow.guard' node scripts/fork-integration.ts lock --operation release --owner '${runId}'"
            }
        }
    }
}

def checkAppleNotarizationAccount() {
    node('macos') {
        stage('Apple notarization account') {
            withCredentials([
                string(credentialsId: 'apple-api-issuer', variable: 'APPLE_API_ISSUER'),
                string(credentialsId: 'apple-api-key-id', variable: 'APPLE_API_KEY_ID'),
                file(credentialsId: 'apple-api-key-p8', variable: 'APPLE_API_KEY'),
            ]) {
                sh '''
                    xcrun notarytool history \
                        --key-id "$APPLE_API_KEY_ID" \
                        --key "$APPLE_API_KEY" \
                        --issuer "$APPLE_API_ISSUER" >/dev/null
                '''
            }
        }
    }
}

def diagnoseAppleNotarizationAccount() {
    def failed = false
    for (label in ['built-in', 'macos']) {
        node(label) {
            stage("Notary API: ${label}") {
                checkout scm
                withEnv(["PATH=/Users/jenkins/.nvm/versions/node/v24.14.0/bin:${env.PATH}"]) {
                    if (label == 'macos') {
                        sh 'xcode-select -p; xcrun --find notarytool; xcrun notarytool --version'
                    }
                    withCredentials([
                        string(credentialsId: 'apple-api-issuer', variable: 'APPLE_API_ISSUER'),
                        string(credentialsId: 'apple-api-key-id', variable: 'APPLE_API_KEY_ID'),
                        file(credentialsId: 'apple-api-key-p8', variable: 'APPLE_API_KEY'),
                    ]) {
                        def status = sh(returnStatus: true, script: 'node scripts/diagnose-apple-notarization.ts')
                        if (status != 0) failed = true
                    }
                }
            }
        }
    }
    if (failed) error('Apple Notary API diagnostics failed; compare the sanitized responses from both hosts.')
}

def buildMac(String slug, String candidateRef, String version, boolean publishRelease) {
    node('macos') {
        stage("${slug}: macOS arm64 + x64") {
            try {
                retry(count: 2, conditions: [agent(), nonresumable()]) {
                    checkoutCandidate("candidate-${slug}", candidateRef)
                    withEnv([
                        "PATH=/Users/jenkins/.nvm/versions/node/v24.14.0/bin:/Users/jenkins/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:${env.PATH}",
                        'RUSTUP_TOOLCHAIN=stable',
                        'T3CODE_DESKTOP_UPDATE_REPOSITORY=YuryYudin/t3code',
                        'T3CODE_MACOS_PASSKEYS=false',
                    ]) {
                        installWorkspace()
                        sh 'rustup update stable --no-self-update'
                        sh 'rustup target add x86_64-apple-darwin'
                        def macCredentials = [
                            string(credentialsId: 't3code-clerk-publishable-key', variable: 'T3CODE_CLERK_PUBLISHABLE_KEY'),
                            string(credentialsId: 't3code-clerk-jwt-template', variable: 'T3CODE_CLERK_JWT_TEMPLATE'),
                            string(credentialsId: 't3code-clerk-cli-oauth-client-id', variable: 'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID'),
                            string(credentialsId: 't3code-relay-url', variable: 'T3CODE_RELAY_URL'),
                        ]
                        if (publishRelease) {
                            sh 'python3 scripts/ensure-apple-developer-id-g2.py'
                            macCredentials += [
                                string(credentialsId: 'apple-certificate', variable: 'CSC_LINK'),
                                string(credentialsId: 'apple-certificate-password', variable: 'CSC_KEY_PASSWORD'),
                                string(credentialsId: 'apple-api-issuer', variable: 'APPLE_API_ISSUER'),
                                string(credentialsId: 'apple-api-key-id', variable: 'APPLE_API_KEY_ID'),
                                file(credentialsId: 'apple-api-key-p8', variable: 'APPLE_API_KEY'),
                            ]
                        }
                        def signingArg = publishRelease ? '--signed' : ''
                        withCredentials(macCredentials) {
                            sh """
                                corepack pnpm exec node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version ${version} --output-dir artifacts/mac-arm64 ${signingArg} --verbose
                                corepack pnpm exec node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch x64 --build-version ${version} --output-dir artifacts/mac-x64 ${signingArg} --verbose
                            """
                            if (publishRelease) {
                                sh '''
                                for dmg in artifacts/mac-arm64/*.dmg artifacts/mac-x64/*.dmg; do
                                    xcrun notarytool submit "$dmg" \
                                        --key-id "$APPLE_API_KEY_ID" \
                                        --key "$APPLE_API_KEY" \
                                        --issuer "$APPLE_API_ISSUER" \
                                        --wait \
                                        --timeout 20m
                                    xcrun stapler staple "$dmg"
                                done
                                '''
                            }
                        }
                        sh '''
                            test -f artifacts/mac-arm64/latest-mac.yml
                            test -f artifacts/mac-x64/latest-mac.yml
                            mv artifacts/mac-x64/latest-mac.yml artifacts/mac-x64/latest-mac-x64.yml
                        '''
                        if (publishRelease) {
                            sh '''
                                xcrun stapler validate artifacts/mac-arm64/*.dmg
                                xcrun stapler validate artifacts/mac-x64/*.dmg
                            '''
                        }
                        stash name: "artifacts-mac-${slug}", includes: 'artifacts/mac-arm64/*,artifacts/mac-x64/*'
                    }
                }
            } finally {
                deleteDir()
            }
        }
    }
}

def buildLinux(String slug, String candidateRef, String version) {
    node('linux') {
        stage("${slug}: Linux x64 + WSL runtime") {
            checkoutCandidate("candidate-${slug}", candidateRef)
            withEnv([
                'CC=clang-15',
                'CXX=clang++-15',
                'RUSTUP_TOOLCHAIN=stable',
                'T3CODE_DESKTOP_UPDATE_REPOSITORY=YuryYudin/t3code',
            ]) {
                installWorkspace()
                sh "node scripts/update-release-package-versions.ts ${version}"
                sh '''
                    rustup update stable --no-self-update
                    pkg-config --exists libsecret-1
                    command -v convert
                '''
                sh "corepack pnpm exec node scripts/build-desktop-artifact.ts --platform linux --target AppImage --arch x64 --build-version ${version} --output-dir artifacts/linux-x64 --verbose"
                sh '''
                    vp_home="$PWD/.vite-plus-ci"
                    curl --silent --show-error --fail-with-body --location https://vite.plus | VP_VERSION=0.3.2 VP_HOME="$vp_home" VP_SELF_SETUP_NO_MODIFY_PATH=1 bash
                    PATH="$vp_home/bin:$PATH" VP_HOME="$vp_home" "$vp_home/bin/vp" env on
                    PATH="$vp_home/bin:$PATH" VP_HOME="$vp_home" VP_NODE_VERSION=26.8.2 "$vp_home/bin/vp" env exec node apps/server/scripts/cli.ts build-exe --verbose
                '''
                sh """
                    mkdir -p artifacts/cli-resource-monitor/linux-x64 artifacts/wsl-runtime
                    cp native/resource-monitor/target/x86_64-unknown-linux-gnu/release/t3-resource-monitor artifacts/cli-resource-monitor/linux-x64/t3-resource-monitor
                    corepack pnpm exec node scripts/build-cli-archive.ts --platform linux --arch x64 --version ${version} --resource-monitor-dir artifacts/cli-resource-monitor --output-dir artifacts/wsl-runtime
                    corepack pnpm exec node scripts/smoke-cli-archive.ts --archive artifacts/wsl-runtime/t3-${version}-linux-x64.tar.gz --expect-version ${version}
                """
            }
            stash name: "artifacts-linux-${slug}", includes: 'artifacts/linux-x64/*,artifacts/wsl-runtime/*.tar.gz'
        }
    }
}

def runQuality(String slug, String candidateRef) {
    node('linux') {
        stage("${slug}: Feature + release gates") {
            checkoutCandidate("candidate-${slug}", candidateRef)
            installWorkspace()
            sh 'git config --local status.showUntrackedFiles all; echo .fork-quality.log >> .git/info/exclude'
            try {
            sh '''#!/usr/bin/env bash
                set -euo pipefail
                exec > >(tee .fork-quality.log) 2>&1
                node scripts/fork-release.ts verify-bootstrap
                corepack pnpm exec tsc --noEmit -p scripts/tsconfig.json
                corepack pnpm run test:project-collections-acceptance
                corepack pnpm exec vp test run scripts/fork-integration.test.ts scripts/fork-release.test.ts scripts/build-desktop-artifact.test.ts apps/server/src/orchestration/decider.externalAlert.test.ts apps/server/src/bin.test.ts packages/contracts/src/orchestration.externalAlert.test.ts packages/contracts/src/orchestration.test.ts packages/contracts/src/ipc.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts apps/desktop/src/app/DesktopAppIdentity.test.ts apps/desktop/src/app/DesktopPreReadyPlatform.test.ts
                corepack pnpm exec vp run --filter @t3tools/contracts --filter @t3tools/shared --filter @t3tools/client-runtime --filter t3 --filter @t3tools/web --filter @t3tools/mobile --filter @t3tools/desktop typecheck
                test -z "$(git status --porcelain)"
            '''
            } finally {
                stash name: "quality-feedback-${slug}", includes: ".fork-quality.log", allowEmpty: true
            }
        }
    }
}

def checkMobileNative(String slug, String candidateRef, String observed) {
    node('ggnode2') {
        stage("${slug}: Android native compatibility") {
            checkoutCandidate("candidate-${slug}", candidateRef)
            // Native transitives and patches can change without a mobile manifest edit.
            def changed = sh(returnStdout: true, script: "git diff --name-only ${observed} HEAD -- apps/mobile/package.json pnpm-workspace.yaml pnpm-lock.yaml patches apps/mobile/modules apps/mobile/plugins apps/mobile/app.config.ts apps/mobile/app.json apps/mobile/babel.config.js apps/mobile/metro.config.js").trim()
            if (!changed) {
                echo 'Mobile dependency and native inputs are unchanged.'
                return
            }
            withEnv(['EXPO_NO_DOTENV=1', 'EXPO_NO_GIT_STATUS=1', 'APP_VARIANT=development']) {
                installWorkspace()
                try {
                sh '''#!/usr/bin/env bash
                    set -euo pipefail
                    exec > >(tee .fork-quality.log) 2>&1
                    export ANDROID_HOME="$HOME/Android/Sdk"
                    test -d "$ANDROID_HOME"
                    java -version
                    cd apps/mobile
                    corepack pnpm exec expo prebuild --clean --platform android --no-install
                    cd android
                    ./gradlew :app:assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a
                '''
                } finally {
                    stash name: "quality-feedback-${slug}", includes: '.fork-quality.log', allowEmpty: true
                }
            }
        }
    }
}

def buildWindows(String slug, String candidateRef, String version) {
    node('pockeo-windows-3') {
        stage("${slug}: Windows x64 unsigned") {
            checkoutCandidate("candidate-${slug}", candidateRef)
            unstash "artifacts-linux-${slug}"
            withEnv([
                'RUSTUP_TOOLCHAIN=stable',
                'T3CODE_DESKTOP_UPDATE_REPOSITORY=YuryYudin/t3code',
            ]) {
                installWorkspace()
                bat 'rustup update stable --no-self-update'
                bat "corepack pnpm exec node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64 --build-version ${version} --output-dir artifacts\\windows-x64 --wsl-runtime artifacts\\wsl-runtime\\t3-${version}-linux-x64.tar.gz --verbose"
            }
            stash name: "artifacts-windows-${slug}", includes: 'artifacts/windows-x64/*'
        }
    }
}

def reportIncident(Map resolved, String failureClass, String summary) {
    node('built-in') {
        checkout scm
        sh 'git clean -ffdx'
        withCredentials([
            string(credentialsId: 'github-incident-token', variable: 'GITHUB_TOKEN'),
            string(credentialsId: 't3code-jenkins-token', variable: 'T3CODE_JENKINS_TOKEN'),
            string(credentialsId: 't3code-jenkins-base-url', variable: 'T3CODE_JENKINS_BASE_URL'),
            string(credentialsId: 't3code-jenkins-project-id', variable: 'T3CODE_JENKINS_PROJECT_ID'),
            string(credentialsId: 't3code-jenkins-model-selection', variable: 'T3CODE_JENKINS_MODEL_SELECTION'),
        ]) {
            writeFile file: '.fork-incident-detail.txt', text: "Upstream: ${resolved.target.commit}\nFork source: ${resolved.candidateSourceSha}\nObserved integration: ${resolved.observedIntegrationSha}\n${summary}\n"
            def detailStatus = sh(returnStatus: true, script: "node scripts/fork-integration.ts inspect ${integrationArgs(resolved)} > .fork-repair-detail.json")
            if (detailStatus == 0) writeFile file: '.fork-incident-detail.txt', text: readFile('.fork-incident-detail.txt') + readFile('.fork-repair-detail.json')
            sh "node scripts/fork-release.ts incident open --state-dir '${env.FORK_RELEASE_STATE_DIR}' --mode ${resolved.mode} --target-identity '${resolved.targetIdentity}' --failure-class ${failureClass} --title 'T3 Code fork maintenance failed' --summary '${failureClass} gate failed' --detail-file .fork-incident-detail.txt --url '${env.BUILD_URL}'"
        }
    }
}

def recoverIncidents(Map resolved) {
    node('built-in') {
        checkout scm
        sh 'git clean -ffdx'
        withCredentials([
            string(credentialsId: 'github-incident-token', variable: 'GITHUB_TOKEN'),
            string(credentialsId: 't3code-jenkins-token', variable: 'T3CODE_JENKINS_TOKEN'),
            string(credentialsId: 't3code-jenkins-base-url', variable: 'T3CODE_JENKINS_BASE_URL'),
            string(credentialsId: 't3code-jenkins-project-id', variable: 'T3CODE_JENKINS_PROJECT_ID'),
            string(credentialsId: 't3code-jenkins-model-selection', variable: 'T3CODE_JENKINS_MODEL_SELECTION'),
        ]) {
            sh "node scripts/fork-release.ts incident recover --state-dir '${env.FORK_RELEASE_STATE_DIR}' --target-identity '${resolved.targetIdentity}' --url '${env.BUILD_URL}'"
        }
    }
}

def queueIntegrationFollowup(Map resolved) {
    if (env.BRANCH_NAME != 'main' || params.DRY_RUN || params.ACTION == 'validate-only') return
    node('built-in') {
        checkout scm
        def upstreamHead = sh(returnStdout: true, script: 'git ls-remote https://github.com/pingdotgg/t3code.git refs/heads/main | cut -f1').trim()
        def mainHead
        sshagent(credentials: ['github-pockeo-ssh']) {
            mainHead = sh(returnStdout: true, script: 'git ls-remote origin refs/heads/main | cut -f1').trim()
        }
        if (upstreamHead != resolved.target.commit || mainHead != resolved.candidateSourceSha) {
            echo 'New source inputs arrived during verification; queueing one integration follow-up.'
            build job: 't3code/main', wait: false, parameters: [
                string(name: 'ACTION', value: 'sync-upstream'),
                string(name: 'SOURCE_REF', value: ''),
                string(name: 'UPSTREAM_REF', value: ''),
                booleanParam(name: 'DRY_RUN', value: false),
            ]
        }
    }
}

def runCandidate(Map resolved, String slug, boolean publishRelease) {
    def failureClass = 'patch-replay'
    try {
        def managed = params.ACTION != 'validate-only' && !params.DRY_RUN && !resolved.firstRelease
        def incremental = managed && !publishRelease
        resolved.candidateKind = publishRelease ? 'stable' : 'integration'
        if (publishRelease) {
            failureClass = 'mac-signing'
            checkAppleNotarizationAccount()
        } else {
            echo 'Integration validates all platform builds without release signing or notarization.'
        }
        failureClass = 'patch-replay'
        def candidateRef = managed ? prepareIntegration(resolved, slug) : prepareCandidate(resolved, slug)
        if (!candidateRef) {
            echo 'Integration already contains the frozen main and upstream inputs and has verified evidence; skipping unchanged builds.'
            if (!params.DRY_RUN) recoverIncidents(resolved)
            return
        }
        def version = resolved.releaseVersion ?: "0.0.0-nightly.${env.BUILD_NUMBER}"
        failureClass = 'validation'
        def qualityPassed = false
        while (!qualityPassed) {
            try {
                runQuality(slug, candidateRef)
                if (managed) {
                    def observedMobile = publishRelease ? resolved.observedMainSha : resolved.observedIntegrationSha
                    if (observedMobile == '0000000000000000000000000000000000000000') observedMobile = resolved.target.commit
                    checkMobileNative(slug, candidateRef, observedMobile)
                }
                qualityPassed = true
            } catch (qualityError) {
                if (!managed) throw qualityError
                requestIntegrationRepair(resolved, "quality-feedback-${slug}")
                ensureIntegrationBundle(resolved, slug, candidateRef)
            }
        }
        if (managed) {
            node('built-in') {
                checkout scm
                sh "node scripts/fork-integration.ts quality ${integrationArgs(resolved)}"
            }
        }
        parallel failFast: false,
            macos: { buildMac(slug, candidateRef, version, publishRelease) },
            linuxWindows: {
                buildLinux(slug, candidateRef, version)
                buildWindows(slug, candidateRef, version)
            }
        failureClass = 'packaging'
        node('built-in') {
            stage("${slug}: Assemble + verify") {
                checkoutCandidate("candidate-${slug}", candidateRef)
                unstash "artifacts-mac-${slug}"
                unstash "artifacts-linux-${slug}"
                unstash "artifacts-windows-${slug}"
                installWorkspace()
                sh '''
                    mkdir -p release-complete
                    for artifact in artifacts/mac-arm64/* artifacts/mac-x64/* artifacts/linux-x64/* artifacts/windows-x64/*; do
                        if [ "${artifact##*/}" != builder-debug.yml ]; then
                            cp "$artifact" release-complete/
                        fi
                    done
                    node scripts/merge-update-manifests.ts --platform mac release-complete/latest-mac.yml release-complete/latest-mac-x64.yml release-complete/latest-mac.yml
                    rm release-complete/latest-mac-x64.yml
                    (cd release-complete && find . -maxdepth 1 -type f ! -name SHA256SUMS.txt -print0 | sort -z | xargs -0 shasum -a 256 | sed 's#  ./#  #' > SHA256SUMS.txt)
                '''
                failureClass = 'manifest-verification'
                sh "node scripts/fork-release.ts verify-assets --version ${version} --assets release-complete"
                if (publishRelease) {
                    withCredentials([string(credentialsId: 'github-release-token', variable: 'GITHUB_TOKEN')]) {
                        sshagent(credentials: ['github-pockeo-ssh']) {
                            sh "node scripts/fork-release.ts release-draft --version ${version} --candidate refs/remotes/fork-candidate --assets release-complete --dry-run ${params.DRY_RUN}"
                        }
                    }
                }
                if (managed) {
                    sh "node scripts/fork-integration.ts verified ${integrationArgs(resolved)} --build '${env.BUILD_URL}'"
                }
                archiveArtifacts artifacts: 'release-complete/*', fingerprint: true
                stash name: "release-complete-${slug}", includes: 'release-complete/*'
            }
            if (params.ACTION != 'validate-only') {
                stage("${slug}: Promote") {
                    failureClass = publishRelease ? 'release-publication' : 'branch-promotion'
                    withCredentials([string(credentialsId: 'github-release-token', variable: 'GITHUB_TOKEN')]) {
                        sshagent(credentials: ['github-pockeo-ssh']) {
                            def branch = publishRelease ? 'main' : 'integration/upstream-main'
                            def observed = publishRelease ? resolved.observedMainSha : resolved.observedIntegrationSha
                            if (!observed) { observed = '0000000000000000000000000000000000000000' }
                            def tagArg = publishRelease ? "--tag ${resolved.releaseTag}" : ''
                            sh "node scripts/fork-release.ts promote --candidate refs/remotes/fork-candidate --branch ${branch} --observed-sha ${observed} ${tagArg} --dry-run ${params.DRY_RUN}"
                        }
                    }
                }
            }
        }
        if (!params.DRY_RUN && params.ACTION != 'validate-only') {
            recoverIncidents(resolved)
            if (incremental) queueIntegrationFollowup(resolved)
        }
    } catch (error) {
        if (!params.DRY_RUN && params.ACTION != 'validate-only') {
            reportIncident(resolved, failureClass, "${slug} failed at ${failureClass}: ${error.message}")
        }
        throw error
    }
}

pipeline {
    agent none

    options {
        timestamps()
        disableConcurrentBuilds(abortPrevious: false)
        timeout(time: 6, unit: 'HOURS')
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
    }

    triggers {
        cron(env.BRANCH_NAME == 'main' ? 'H 2 * * *' : '')
    }

    parameters {
        choice(name: 'ACTION', choices: ['auto', 'validate-only', 'out-of-cycle', 'apple-account-check', 'sync-upstream'], description: 'Scheduled tracking, read-only validation, a stable release, an Apple check, or integration-only synchronization.')
        string(name: 'UPSTREAM_REF', defaultValue: '', description: 'Exact upstream commit/tag; valid only for validate-only.')
        string(name: 'SOURCE_REF', defaultValue: '', description: 'Full fork source SHA or HEAD for out-of-cycle or sync-upstream; leave empty to use main.')
        booleanParam(name: 'DRY_RUN', defaultValue: false, description: 'Run every build and verification gate without remote mutation or incidents.')
    }

    environment {
        FORK_RELEASE_STATE_DIR = '/var/lib/jenkins/t3code-fork-release'
        FORK_REPAIR_PROJECT_ROOT = '/home/jjb/Work/OpenCode/t3code-fork-maintenance'
    }

    stages {
        stage('Resolve and execute') {
            steps {
                script {
                    if (params.ACTION == 'auto' && env.BRANCH_NAME != 'main') {
                        echo 'Scheduled fork tracking runs only on main.'
                        return
                    }
                    if (params.ACTION == 'apple-account-check') {
                        diagnoseAppleNotarizationAccount()
                        return
                    }
                    if (params.SOURCE_REF && !(params.ACTION in ['out-of-cycle', 'sync-upstream'])) {
                        error('SOURCE_REF is accepted only for out-of-cycle or sync-upstream.')
                    }
                    if (params.SOURCE_REF && params.SOURCE_REF != 'HEAD' && !(params.SOURCE_REF ==~ /[0-9a-f]{40}/)) {
                        error('SOURCE_REF must be HEAD or a full lowercase commit SHA.')
                    }
                    withWorkflowLock {
                    Map nightly
                    Map stable
                    node('built-in') {
                        checkout scm
                        sh 'git clean -ffdx'
                        sh '''
                            git remote remove upstream 2>/dev/null || true
                            git remote add upstream https://github.com/pingdotgg/t3code.git
                            git fetch --prune --tags upstream '+refs/heads/main:refs/remotes/upstream/main'
                        '''
                        installWorkspace()
                        withCredentials([
                            string(credentialsId: 'github-release-token', variable: 'GITHUB_TOKEN'),
                            string(credentialsId: 't3code-bootstrap-source-sha', variable: 'BOOTSTRAP_SOURCE_SHA'),
                        ]) {
                            def validateRef = params.UPSTREAM_REF ? "--upstream-ref '${params.UPSTREAM_REF}'" : ''
                            def sourceArg = params.SOURCE_REF ? "--source ${params.SOURCE_REF}" : ''
                            def resolveAction = params.ACTION == 'sync-upstream' ? 'out-of-cycle' : params.ACTION
                            def nightlySourceArg = params.ACTION == 'sync-upstream' ? sourceArg : ''
                            sh "node scripts/fork-release.ts resolve --action ${resolveAction} --mode nightly-integration ${validateRef} ${nightlySourceArg} --bootstrap-source-sha \"\$BOOTSTRAP_SOURCE_SHA\" --dry-run ${params.DRY_RUN} > .fork-release-nightly.json"
                            nightly = readResolvedPlan('.fork-release-nightly.json')
                            if (!(params.ACTION in ['validate-only', 'sync-upstream'])) {
                                def stableMode = params.ACTION == 'out-of-cycle' ? 'out-of-cycle-release' : 'automatic-stable-release'
                                sh "node scripts/fork-release.ts resolve --action ${params.ACTION} --mode ${stableMode} ${sourceArg} --bootstrap-source-sha \"\$BOOTSTRAP_SOURCE_SHA\" --dry-run ${params.DRY_RUN} > .fork-release-stable.json"
                                stable = readResolvedPlan('.fork-release-stable.json')
                            }
                        }
                    }
                    if (params.ACTION == 'validate-only') {
                        runCandidate(nightly, 'validate-only', false)
                    } else if (params.ACTION == 'sync-upstream') {
                        runCandidate(nightly, 'nightly-integration', false)
                    } else if (params.ACTION == 'out-of-cycle') {
                        runCandidate(stable, 'out-of-cycle', true)
                    } else if (stable.firstRelease) {
                        runCandidate(stable, 'automatic-stable-release', true)
                    } else {
                        catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', catchInterruptions: false) {
                            runCandidate(nightly, 'nightly-integration', false)
                        }
                        if (stable.releaseRequired) {
                            catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', catchInterruptions: false) {
                                runCandidate(stable, 'automatic-stable-release', true)
                            }
                        } else {
                            echo 'No new upstream stable release requires a fork release.'
                        }
                    }
                    }
                }
            }
        }
    }
}
