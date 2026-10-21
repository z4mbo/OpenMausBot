import base64
import datetime
import fcntl
import hashlib
import json
import os
import stat
import subprocess

MANIFEST_SHA = '30d8f56ef58c392993d31f4639cc9121bd785ec8c8fc95a7348e1c41b197ed44'
IMAGE = 'sha256:78a8daf8ce012d91fa9cb6d041c97ede04c5b2c3d42cec140945ab7a7ab9ab52'
DIRECTORIES = [
    '/root/origin-release-staging/0.2.8/downloads',
    '/root/origin-release-staging/0.2.9/downloads',
    '/root/origin-release-staging/0.2.12-candidate-032-d09a92021/downloads',
]
SUFFIXES = ['arm64.dmg', 'arm64.dmg.blockmap', 'arm64.zip', 'arm64.zip.blockmap', 'setup.exe', 'setup.exe.blockmap', 'windows-x64.zip', 'x64.dmg', 'x64.dmg.blockmap', 'x64.zip', 'x64.zip.blockmap']
PUBLIC = '/root/multi-ghost/origin-downloads'
SITE049 = '/root/origin-release-staging/0.4.2-cycle049/site'


def require(value, message):
    if not value:
        raise ValueError(message)


def signature(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_nlink, str(info.st_mtime_ns), str(info.st_ctime_ns)]


def directory_core(value):
    return [value[index] for index in [0, 1, 2, 4]]


def emit(phase, **fields):
    print(json.dumps({'phase': phase, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **fields}), flush=True)


def open_directory(path):
    require(path.startswith('/') and os.path.normpath(path) == path, 'Nonliteral directory refused')
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in path.strip('/').split('/'):
            before = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            require(stat.S_ISDIR(before.st_mode) and not stat.S_ISLNK(before.st_mode), 'Directory symlink or special entry refused')
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            require(signature(os.fstat(child)) == signature(before), 'Directory changed while opening')
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def snapshot(descriptor):
    names = sorted(os.listdir(descriptor))
    require(len(names) <= 10000, 'Protected directory inventory is unexpectedly large')
    return {name: signature(os.stat(name, dir_fd=descriptor, follow_symlinks=False)) for name in names}


def metadata_tree(descriptor, prefix='', depth=0):
    require(depth <= 20, 'Private049 metadata depth exceeded')
    result = {}
    for name, value in snapshot(descriptor).items():
        require(not stat.S_ISLNK(value[2]), 'Private049 symlink refused')
        key = prefix + name
        result[key] = value
        if stat.S_ISDIR(value[2]):
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            try:
                require(signature(os.fstat(child)) == value, 'Private049 directory changed')
                result.update(metadata_tree(child, key + '/', depth + 1))
            finally:
                os.close(child)
    require(len(result) <= 5000, 'Private049 metadata closure exceeded')
    return result


def command(args):
    result = subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    require(len(result.stdout) <= 1024 * 1024, 'Metadata output exceeded')
    return result.stdout.decode().strip()


def current_image():
    return command(['docker', 'container', 'inspect', 'multi-ghost-origin-1', '--format', '{{.Image}}'])


def images():
    return sorted(command(['docker', 'image', 'ls', '--all', '--digests', '--no-trunc', '--format', '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Digest}}']).splitlines())


def free_bytes():
    values = os.statvfs('/')
    return values.f_bavail * values.f_frsize


def hash_descriptor(descriptor):
    os.lseek(descriptor, 0, os.SEEK_SET)
    value = hashlib.sha256()
    while True:
        data = os.read(descriptor, 4 * 1024 * 1024)
        if not data:
            return value.hexdigest()
        value.update(data)


def expected_signature(item):
    value = item['private']
    return [value['device'], value['inode'], value['mode'], value['bytes'], value['nlink'], value['mtimeNs'], value['ctimeNs']]


def cleanup(request):
    require(request.get('execute') is True and request.get('approvedBy') == 'root', 'Root execution admission required')
    manifest_bytes = base64.b64decode(request['manifestBase64'], validate=True)
    require(hashlib.sha256(manifest_bytes).hexdigest() == MANIFEST_SHA == request['manifestSha256'], 'Reviewed manifest differs')
    manifest = json.loads(manifest_bytes)
    proof_bytes = base64.b64decode(request['proofBase64'], validate=True)
    proof_pin = next(row['sha256'] for row in manifest['evidence'] if row['file'] == 'capacity-two-copy-proof.json')
    require(hashlib.sha256(proof_bytes).hexdigest() == proof_pin, 'Reviewed descriptor proof differs')
    proof = json.loads(proof_bytes)
    require(manifest['count'] == 33 and len(manifest['candidates']) == 3, 'Literal33 scope differs')
    require([row['privateDirectory'] for row in manifest['candidates']] == DIRECTORIES, 'Private directory scope differs')
    require(proof['currentImage'] == IMAGE == request['expectedImage'], 'Current-image pin differs')
    for candidate in manifest['candidates']:
        require(len(candidate['files']) == 11, 'Literal11 payload scope differs')
        require(sorted(row['name'] for row in candidate['files']) == sorted('Origin-' + candidate['version'] + '-' + suffix for suffix in SUFFIXES), 'Payload basenames differ')
        for item in candidate['files']:
            require(item['privatePath'] == candidate['privateDirectory'] + '/' + item['name'] and '/' not in item['name'] and '\\' not in item['name'], 'Nonliteral payload path refused')
            require(item['publicCopyPresent'] is False and item['private']['nlink'] == 1, 'Private independent-copy requirement differs')
    directories, payloads, deleted = {}, [], []
    lock = os.open('/var/lock/origin-release.lock', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(stat.S_ISREG(os.fstat(lock).st_mode), 'Release lock is not a regular file')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for path in sorted(set(proof['protectedEntrySnapshots']) | set(DIRECTORIES) | {SITE049, os.path.dirname(SITE049)}):
            directories[path] = open_directory(path)
        protected_before = {path: snapshot(directories[path]) for path in proof['protectedEntrySnapshots']}
        require(protected_before == proof['protectedEntrySnapshots'], 'Protected release metadata drifted since reviewed proof')
        site_before = metadata_tree(directories[SITE049])
        site_parent_before = snapshot(directories[os.path.dirname(SITE049)])
        images_before = images()
        free_before = free_bytes()

        def verify_baseline():
            require(current_image() == IMAGE, 'Current website image drifted')
            for name, expected in proof['feeds'].items():
                info = os.stat(name, dir_fd=directories[PUBLIC], follow_symlinks=False)
                require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_size <= 65536, 'Public feed is not a bounded regular file')
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directories[PUBLIC])
                try:
                    require(signature(os.fstat(fd)) == signature(info), 'Feed identity changed')
                    data = os.read(fd, 65537)
                    require(signature(os.fstat(fd)) == signature(info) == signature(os.stat(name, dir_fd=directories[PUBLIC], follow_symlinks=False)), 'Feed changed while reading')
                finally:
                    os.close(fd)
                require(hashlib.sha256(data).hexdigest() == expected['sha256'] and data.decode().splitlines()[0] == 'version: 0.7.1', 'Current071 feed differs')

        def verify_protected():
            for path, expected in protected_before.items():
                actual = snapshot(directories[path])
                require(set(actual) == set(expected), 'Protected release entry names changed')
                for name, before in expected.items():
                    child = path + '/' + name
                    if child in DIRECTORIES and deleted:
                        require(directory_core(actual[name]) == directory_core(before), 'Downloads directory identity changed')
                    else:
                        require(actual[name] == before, 'Protected release entry changed: ' + child)
            require(metadata_tree(directories[SITE049]) == site_before, 'Actual cycle049 site closure changed')
            require(snapshot(directories[os.path.dirname(SITE049)]) == site_parent_before, 'Actual cycle049 site parent changed')
            for candidate in manifest['candidates']:
                path = candidate['privateDirectory']
                current = open_directory(path)
                try:
                    require(directory_core(signature(os.fstat(current))) == directory_core(candidate['directoryIdentity']), 'Private path binding changed')
                finally:
                    os.close(current)
                original = next(row['directoryEntries'] for row in proof['candidates'] if row['privateDirectory'] == path)
                expected = {name: value for name, value in original.items() if path + '/' + name not in deleted}
                require(snapshot(directories[path]) == expected, 'Private metadata or remaining payload changed')

        verify_baseline()
        verify_protected()
        for candidate in manifest['candidates']:
            descriptor = directories[candidate['privateDirectory']]
            require(signature(os.fstat(descriptor)) == candidate['directoryIdentity'], 'Private directory identity differs')
            for item in candidate['files']:
                try:
                    os.stat(item['name'], dir_fd=directories[PUBLIC], follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise ValueError('A public counterpart now exists')
                info = os.stat(item['name'], dir_fd=descriptor, follow_symlinks=False)
                require(signature(info) == expected_signature(item) and stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Private payload identity differs')
                fd = os.open(item['name'], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
                payloads.append({'item': item, 'directory': descriptor, 'fd': fd})
                require(signature(os.fstat(fd)) == signature(info), 'Opened payload identity differs')
                require(hash_descriptor(fd) == item['sha256'], 'Private payload SHA256 differs')
                require(signature(os.fstat(fd)) == signature(info) == signature(os.stat(item['name'], dir_fd=descriptor, follow_symlinks=False)), 'Private payload changed while hashing')
                emit('remote-verified', path=item['privatePath'], bytes=item['bytes'], sha256=item['sha256'])
        require(len(payloads) == 33, 'Not every payload was verified')
        verify_protected()
        verify_baseline()
        require(images() == images_before, 'Image inventory changed during verification')
        emit('preflight-complete', count=33, freeBytes=free_before, imagesSha256=hashlib.sha256(json.dumps(images_before).encode()).hexdigest(), localBackupsSha256=request['localBackupsSha256'])
        for index, payload in enumerate(payloads, 1):
            item, directory, fd = payload['item'], payload['directory'], payload['fd']
            verify_protected()
            verify_baseline()
            require(signature(os.fstat(fd)) == expected_signature(item) == signature(os.stat(item['name'], dir_fd=directory, follow_symlinks=False)), 'Payload changed immediately before unlink')
            require(hash_descriptor(fd) == item['sha256'], 'Payload SHA256 changed immediately before unlink')
            emit('unlink-intent', index=index, path=item['privatePath'], sha256=item['sha256'])
            require(signature(os.fstat(fd)) == expected_signature(item) == signature(os.stat(item['name'], dir_fd=directory, follow_symlinks=False)), 'Payload changed during final hash')
            os.unlink(item['name'], dir_fd=directory)
            deleted.append(item['privatePath'])
            os.close(fd)
            payload['fd'] = None
            try:
                os.stat(item['name'], dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise ValueError('Unlinked payload still exists')
            emit('unlinked', index=index, path=item['privatePath'], bytes=item['bytes'], allocatedBytes=item['private']['allocatedBytes'], freeBytes=free_bytes())
        verify_protected()
        verify_baseline()
        require(images() == images_before, 'Image inventory changed during cleanup')
        after = free_bytes()
        emit('complete', count=len(deleted), deleted=deleted, freeBeforeBytes=free_before, freeAfterBytes=after, observedFreeDeltaBytes=after - free_before, image=IMAGE, feeds=proof['feeds'], imagesUnchanged=True, protectedClosureUnchanged=True, expectedDownloadsDirectoryMetadataChangesOnly=True, actual049Site=SITE049, directoriesPreserved=True, localCopiesPreservedByOperator=True)
    except BaseException as error:
        emit('stopped', deleted=deleted, confirmedUnlinks=len(deleted), reason=str(error), reconciliationRequired=True, automaticReplayAllowed=False)
        raise
    finally:
        for payload in payloads:
            if payload['fd'] is not None:
                os.close(payload['fd'])
        for descriptor in directories.values():
            os.close(descriptor)
        os.close(lock)


if 'REQUEST' in globals():
    cleanup(REQUEST)
