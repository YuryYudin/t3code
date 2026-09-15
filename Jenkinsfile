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
                sh "node scripts/fork-release.ts prepare --target ${resolved.target.commit} --candidate-ref ${candidateRef} --first-release ${resolved.firstRelease} --bootstrap-source-sha \"\$BOOTSTRAP_SOURCE_SHA\""
            }
            sh "git bundle create candidate.bundle ${candidateRef}"
            stash name: "candidate-${slug}", includes: 'candidate.bundle'
        }
    }
    return candidateRef
}

def buildMac(String slug, String candidateRef, String version) {
    node('macos') {
        stage("${slug}: macOS arm64 + x64") {
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
                    withCredentials([
                        string(credentialsId: 'apple-certificate', variable: 'CSC_LINK'),
                        string(credentialsId: 'apple-certificate-password', variable: 'CSC_KEY_PASSWORD'),
                        string(credentialsId: 'apple-api-issuer', variable: 'APPLE_API_ISSUER'),
                        string(credentialsId: 'apple-api-key-id', variable: 'APPLE_API_KEY_ID'),
                        file(credentialsId: 'apple-api-key-p8', variable: 'APPLE_API_KEY'),
                        string(credentialsId: 't3code-clerk-publishable-key', variable: 'T3CODE_CLERK_PUBLISHABLE_KEY'),
                        string(credentialsId: 't3code-clerk-jwt-template', variable: 'T3CODE_CLERK_JWT_TEMPLATE'),
                        string(credentialsId: 't3code-clerk-cli-oauth-client-id', variable: 'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID'),
                        string(credentialsId: 't3code-relay-url', variable: 'T3CODE_RELAY_URL'),
                    ]) {
                        sh """
                            corepack pnpm exec node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version ${version} --output-dir artifacts/mac-arm64 --signed --verbose
                            corepack pnpm exec node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch x64 --build-version ${version} --output-dir artifacts/mac-x64 --signed --verbose
                        """
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
                    sh '''
                        test -f artifacts/mac-arm64/latest-mac.yml
                        test -f artifacts/mac-x64/latest-mac.yml
                        mv artifacts/mac-x64/latest-mac.yml artifacts/mac-x64/latest-mac-x64.yml
                        xcrun stapler validate artifacts/mac-arm64/*.dmg
                        xcrun stapler validate artifacts/mac-x64/*.dmg
                    '''
                    stash name: "artifacts-mac-${slug}", includes: 'artifacts/mac-arm64/*,artifacts/mac-x64/*'
                }
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
            sh '''
                node scripts/fork-release.ts verify-bootstrap
                corepack pnpm run test:project-collections-acceptance
                corepack pnpm exec vp test run scripts/fork-release.test.ts scripts/build-desktop-artifact.test.ts apps/server/src/orchestration/decider.externalAlert.test.ts apps/server/src/bin.test.ts packages/contracts/src/orchestration.externalAlert.test.ts packages/contracts/src/orchestration.test.ts packages/contracts/src/ipc.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts apps/desktop/src/app/DesktopAppIdentity.test.ts apps/desktop/src/app/DesktopPreReadyPlatform.test.ts
                corepack pnpm exec vp run --filter @t3tools/contracts --filter @t3tools/shared --filter @t3tools/client-runtime --filter t3 --filter @t3tools/web --filter @t3tools/mobile --filter @t3tools/desktop typecheck
                test -z "$(git status --porcelain)"
            '''
        }
    }
}

def buildWindows(String slug, String candidateRef, String version) {
    node('pockeo-windows') {
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
            sh "node scripts/fork-release.ts incident open --state-dir '${env.FORK_RELEASE_STATE_DIR}' --mode ${resolved.mode} --target-identity '${resolved.targetIdentity}' --failure-class ${failureClass} --title 'T3 Code fork maintenance failed' --summary '${summary}' --url '${env.BUILD_URL}'"
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

def runCandidate(Map resolved, String slug, boolean publishRelease) {
    def failureClass = 'patch-replay'
    try {
        def candidateRef = prepareCandidate(resolved, slug)
        def version = resolved.releaseVersion ?: "0.0.0-nightly.${env.BUILD_NUMBER}"
        failureClass = 'validation'
        parallel failFast: false,
            quality: { runQuality(slug, candidateRef) },
            macos: { buildMac(slug, candidateRef, version) },
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
                if (publishRelease) {
                    withCredentials([string(credentialsId: 'github-release-token', variable: 'GITHUB_TOKEN')]) {
                        sshagent(credentials: ['github-pockeo-ssh']) {
                            sh "node scripts/fork-release.ts release-draft --version ${version} --candidate refs/remotes/fork-candidate --assets release-complete --dry-run ${params.DRY_RUN}"
                        }
                    }
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
                            def observed = publishRelease ? resolved.observedMainSha : sh(returnStdout: true, script: "git ls-remote origin refs/heads/${branch} | cut -f1").trim()
                            if (!observed) { observed = '0000000000000000000000000000000000000000' }
                            def tagArg = publishRelease ? "--tag ${resolved.releaseTag}" : ''
                            sh "node scripts/fork-release.ts promote --candidate refs/remotes/fork-candidate --branch ${branch} --observed-sha ${observed} ${tagArg} --dry-run ${params.DRY_RUN}"
                        }
                    }
                }
            }
        }
        if (!params.DRY_RUN && params.ACTION != 'validate-only') { recoverIncidents(resolved) }
    } catch (error) {
        if (!params.DRY_RUN && params.ACTION != 'validate-only') {
            reportIncident(resolved, failureClass, "${slug} failed at ${failureClass}")
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
        cron('H 2 * * *')
    }

    parameters {
        choice(name: 'ACTION', choices: ['auto', 'validate-only', 'out-of-cycle'], description: 'Scheduled stable tracking, an exact read-only validation, or a manual release.')
        string(name: 'UPSTREAM_REF', defaultValue: '', description: 'Exact upstream commit/tag; valid only for validate-only.')
        booleanParam(name: 'DRY_RUN', defaultValue: false, description: 'Run every build and verification gate without remote mutation or incidents.')
    }

    environment {
        FORK_RELEASE_STATE_DIR = '/var/lib/jenkins/t3code-fork-release'
    }

    stages {
        stage('Resolve and execute') {
            steps {
                script {
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
                            sh "node scripts/fork-release.ts resolve --action ${params.ACTION} --mode nightly-integration ${validateRef} --bootstrap-source-sha \"\$BOOTSTRAP_SOURCE_SHA\" --dry-run ${params.DRY_RUN} > .fork-release-nightly.json"
                            nightly = readResolvedPlan('.fork-release-nightly.json')
                            if (params.ACTION != 'validate-only') {
                                def stableMode = params.ACTION == 'out-of-cycle' ? 'out-of-cycle-release' : 'automatic-stable-release'
                                sh "node scripts/fork-release.ts resolve --action ${params.ACTION} --mode ${stableMode} --bootstrap-source-sha \"\$BOOTSTRAP_SOURCE_SHA\" --dry-run ${params.DRY_RUN} > .fork-release-stable.json"
                                stable = readResolvedPlan('.fork-release-stable.json')
                            }
                        }
                    }
                    if (params.ACTION == 'validate-only') {
                        runCandidate(nightly, 'validate-only', false)
                    } else if (params.ACTION == 'out-of-cycle') {
                        runCandidate(stable, 'out-of-cycle', true)
                    } else if (stable.firstRelease) {
                        runCandidate(stable, 'automatic-stable-release', true)
                    } else {
                        runCandidate(nightly, 'nightly-integration', false)
                        if (stable.releaseRequired) {
                            runCandidate(stable, 'automatic-stable-release', true)
                        } else {
                            echo 'No new upstream stable release; nightly integration completed without publication.'
                        }
                    }
                }
            }
        }
    }
}
