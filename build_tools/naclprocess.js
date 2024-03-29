/*
 * Copyright (c) 2014 The Native Client Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

'use strict';

/**
 * NaClProcessManager provides a framework for NaCl executables to run within a
 * web-based terminal.
 */
function NaClProcessManager() {
  var self = this;
  self.onError = function() {};
  self.onStdout = function() {};
  self.onRootProgress = function() {};
  self.onRootLoad = function() {};

  // The process which gets the input from the user.
  self.foregroundProcess = null;

  // Process group information keyed by PGID. The value is an object consisting
  // of the fields: {
  //   sid: the session ID of the process group
  //   processes: an object keyed by the PIDs of processes in this group, used
  //       as a set
  // }
  self.processGroups = {};

  // Process information keyed by PID. The value is an object consisting of the
  // fields: {
  //   domElement: the <embed> element of the process,
  //   exitCode: the exit code of the process, or null if the process has not
  //       yet exited,
  //   pgid: the process group ID of the process
  //   ppid: the parent PID of the process
  // }
  self.processes = {};

  // Waiter processes keyed by the PID of the waited process. The waiter
  // is represented by a hash like
  // { reply: a callback to call to report a process exit, options: the
  //     options specfied for the wait (such as WNOHANG) }
  self.waiters = {};

  // Start process IDs at 2, as PIDs 0 and 1 are reserved on real systems.
  self.pid = 2;

  // TODO(bradnelson): Restructure to make sure this isn't racey.
  // NaCl Architecture.
  self.naclArch = null;
  if (chrome && chrome.runtime && chrome.runtime.getPlatformInfo) {
    chrome.runtime.getPlatformInfo(function(platformInfo) {
      self.naclArch = {
        'x86-32': 'i686',
        'x86-64': 'x86_64',
        'arm': 'arm',
      }[platformInfo.nacl_arch] || platformInfo.nacl_arch;
    });
  }
};

/**
 * Constants that correspond to values in errno.h.
 * @namespace
 */
var Errno = {
  /**
   * Operation not permitted.
   * @type {number}
   */
  EPERM: 1,

  /**
   * File or directory not found.
   * @type {number}
   */
  ENOENT: 2,

  /**
   * Process not found.
   * @type {number}
   */
  ESRCH: 3,

  /**
   * No child processes.
   * @type {number}
   */
  ECHILD: 10,

  /**
   * Permission denied.
   * @type {number}
   */
  EACCES: 13,

  /**
   * Invalid argument.
   * @type {number}
   */
  EINVAL: 22,
};

/*
 * The PID of the "init" process. Processes directly spawned from JavaScript
 * have their parent PID set to this value.
 * @type {number}
 */
NaClProcessManager.INIT_PID = 1;

/**
 * The error thrown when the user tries to execute operations on the foreground
 * process when there is no such process.
 * @const
 */
NaClProcessManager.NO_FG_ERROR = 'No foreground process running.';

/**
 * The TTY prefix for communicating with NaCl processes.
 * @const
 */
NaClProcessManager.prefix = 'nacl_process';

/**
 * The "no hang" flag for waitpid().
 * @type {number}
 */
NaClProcessManager.WNOHANG = 1;

/*
 * Exit code when a process has an error.
 * @type {number}
 */
NaClProcessManager.EX_NO_EXEC = 126;

/*
 * Exit code when a process is ended with SIGKILL.
 * @type {number}
 */
NaClProcessManager.EXIT_CODE_KILL = 128 + 9;

/**
 * This environmnent variable should be set to 1 to enable Control+C quitting
 * of processes.
 * @const
 */
NaClProcessManager.ENV_ABORT = 'ENABLE_CONTROL_C';

/**
 * This is the value to which the ENV_ABORT environment variable should be set
 * in order to enable Control+C.
 * @const
 */
NaClProcessManager.ENV_ABORT_VALUE = '1';


/**
 * Environment variable that can be set to the value in ENV_SPAWN_MODE or
 * ENV_SPAWN_EMBED_VALUE to enable viewing of graphical output from programs.
 * @const
 */
NaClProcessManager.ENV_SPAWN_MODE = 'NACL_SPAWN_MODE';

/**
 * Value for ENV_SPAWN_MODE that makes programs open in a new window.
 * @const
 */
NaClProcessManager.ENV_SPAWN_POPUP_VALUE = 'popup';

/**
 * Value for ENV_SPAWN_MODE that makes the graphical output of programs appear
 * within the terminal window.
 * @const
 */
NaClProcessManager.ENV_SPAWN_EMBED_VALUE = 'embed';

/**
 * Environment variable that can be set to change the width of the popup when
 * ENV_SPAWN_MODE is set to ENV_SPAWN_POPUP_VALUE.
 * @const
 */
NaClProcessManager.ENV_POPUP_WIDTH = 'NACL_POPUP_WIDTH';

/**
 * Environment variable that can be set to change the height of the popup when
 * ENV_SPAWN_MODE is set to ENV_SPAWN_POPUP_VALUE.
 * @const
 */
NaClProcessManager.ENV_POPUP_HEIGHT = 'NACL_POPUP_HEIGHT';

/*
 * Default width for a popup, in pixels.
 * @type {number}
 */
NaClProcessManager.POPUP_WIDTH_DEFAULT = 600;

/*
 * Default height for a popup, in pixels.
 * @type {number}
 */
NaClProcessManager.POPUP_HEIGHT_DEFAULT  = 400;

/**
 * Environment variable that can be set to change the width of the embedded
 * element when ENV_SPAWN_MODE is set to ENV_SPAWN_EMBED_VALUE.
 * @const
 */
NaClProcessManager.ENV_EMBED_WIDTH = 'NACL_EMBED_WIDTH';

/**
 * Environment variable that can be set to change the height of the embedded
 * element when ENV_SPAWN_MODE is set to ENV_SPAWN_EMBED_VALUE.
 * @const
 */
NaClProcessManager.ENV_EMBED_HEIGHT = 'NACL_EMBED_HEIGHT';

/*
 * Default width for a spawned embed, in any units recognized by CSS.
 * @const
 */
NaClProcessManager.EMBED_WIDTH_DEFAULT = '100%';

/*
 * Default height for a spawned embed, in any units recognized by CSS.
 * @const
 */
NaClProcessManager.EMBED_HEIGHT_DEFAULT  = '50%';

/**
 * Handles a stdout event.
 * @callback stdoutCallback
 * @param {string} msg The string sent to stdout.
 */

/**
 * Listen for stdout from the spawned processes.
 * @param {stdoutCallback} callback The callback to be called on a stdout write.
 */
NaClProcessManager.prototype.setStdoutListener = function(callback) {
  this.onStdout = callback;
}

/**
 * Handles an error event.
 * @callback errorCallback
 * @param {string} cmd The name of the process with the error.
 * @param {string} err The error message.
 */

/**
 * Listen for errors from the spawned processes.
 * @param {errorCallback} callback The callback to be called on error.
 */
NaClProcessManager.prototype.setErrorListener = function(callback) {
  this.onError = callback;
}

/**
 * Handles a progress event from the root process.
 * @callback rootProgressCallback
 * @param {string} url The URL that is being loaded.
 * @param {boolean} lengthComputable Is our progress quantitatively measurable?
 * @param {number} loaded The number of bytes that have been loaded.
 * @param {number} total The total number of bytes to be loaded.
 */

/**
 * Listen for a progress event from the root process.
 * @param {rootProgressCallback} callback The callback to be called on progress.
 */
NaClProcessManager.prototype.setRootProgressListener = function(callback) {
  this.onRootProgress = callback;
}

/**
 * Handles a load event from the root process.
 * @callback rootLoadCallback
 */

/**
 * Listen for a load event from the root process.
 * @param {rootLoadCallback} callback The callback to be called on load.
 */
NaClProcessManager.prototype.setRootLoadListener = function(callback) {
  this.onRootLoad = callback;
}

/**
 * Is the given process the root process of this process manager? A root
 * process is the one created by NaClProcessManager and not spawned by
 * another process.
 * @param {HTMLObjectElement} process The element about which one is inquiring.
 */
NaClProcessManager.prototype.isRootProcess = function(process) {
  return !process.parent;
}

/**
 * Makes the path in a NMF entry to fully specified path.
 * @private
 */
NaClProcessManager.prototype.adjustNmfEntry_ = function(entry) {
  for (var arch in entry) {
    if (arch === 'portable') {
      if (entry[arch]['pnacl-translate'] === undefined ||
          entry[arch]['pnacl-translate']['url'] === undefined) {
        return;
      }
      var path = entry[arch]['pnacl-translate']['url'];
    } else {
      if (entry[arch]['url'] === undefined) {
       return;
      }
      var path = entry[arch]['url'];
    }
    // TODO(bradnelson): Generalize this.
    var html5MountPoint = '/mnt/html5/';
    var homeMountPoint = '/home/user/';
    var tmpMountPoint = '/tmp/';
    if (path.indexOf(html5MountPoint) === 0) {
      path = path.replace(html5MountPoint,
                          'filesystem:' + location.origin + '/persistent/');
    } else if (path.indexOf(homeMountPoint) === 0) {
      path = path.replace(homeMountPoint,
                          'filesystem:' + location.origin +
                          '/persistent/home/');
    } else if (path.indexOf(tmpMountPoint) === 0) {
      path = path.replace(tmpMountPoint,
                          'filesystem:' + location.origin +
                          '/temporary/');
    } else {
      // This is for the dynamic loader.
      var base = location.href.match('.*/')[0];
      path = base + path;
    }
    if (arch === 'portable') {
      entry[arch]['pnacl-translate']['url'] = path;
    } else {
      entry[arch]['url'] = path;
    }
  }
}

/**
 * Handle messages sent to us from NaCl.
 * @private
 */
NaClProcessManager.prototype.handleMessage_ = function(e) {
  var msg = e.data;
  var src = e.srcElement;

  // Set handlers for commands. Each handler is passed three arguments:
  //   msg: the data sent from the NaCl module
  //   reply: a callback to reply to the command
  //   src: the DOM element from which the message was received
  var handlers = {
    nacl_spawn: this.handleMessageSpawn_,
    nacl_wait: this.handleMessageWait_,
    nacl_getpgid: this.handleMessageGetPGID_,
    nacl_setpgid: this.handleMessageSetPGID_,
    nacl_getsid: this.handleMessageGetSID_,
    nacl_setsid: this.handleMessageSetSID_,
    nacl_pipe: this.handleMessagePipe_,
  };

  // TODO(channingh): Once pinned applications support "result" instead of
  // "pid", change calls to reply() to set "result."
  function reply(contents) {
    var reply = {};
    reply[msg['id']] = contents;
    src.postMessage(reply);
  }

  if (msg['command'] && handlers[msg['command']]) {
    console.log(msg['command'] + ': ' + JSON.stringify(msg));
    handlers[msg['command']].call(this, msg, reply, src);
  } else if (msg.indexOf(NaClProcessManager.prefix) === 0) {
    var out = msg.substring(NaClProcessManager.prefix.length);
    this.onStdout(out);
  } else if (msg.indexOf('exited') === 0) {
    var exitCode = parseInt(msg.split(':', 2)[1]);
    if (isNaN(exitCode))
      exitCode = 0;
    this.exit(exitCode, src);
  } else {
    console.log('unexpected message: ' + msg);
    return;
  }
}

/**
 * Handle a nacl_spawn call.
 * @private
 */
NaClProcessManager.prototype.handleMessageSpawn_ = function(msg, reply, src) {
  var self = this;
  var args = msg['args'];
  var envs = msg['envs'];
  var cwd = msg['cwd'];
  var executable = args[0];
  var nmf = msg['nmf'];
  if (nmf) {
    if (nmf['files']) {
      for (var key in nmf['files'])
        self.adjustNmfEntry_(nmf['files'][key]);
    }
    self.adjustNmfEntry_(nmf['program']);
    var blob = new Blob([JSON.stringify(nmf)], {type: 'text/plain'});
    var nmfUrl = window.URL.createObjectURL(blob);
    var naclType = self.checkNaClManifestType_(nmf) || 'nacl';
    reply({
      pid: self.spawn(nmfUrl, args, envs, cwd, naclType, src)
    });
  } else {
    if (NaClProcessManager.nmfWhitelist !== undefined &&
        NaClProcessManager.nmfWhitelist.indexOf(executable) === -1) {
      var replyMsg = {
        pid: -Errno.ENOENT,
      };
      console.log('nacl_spawn(error): ' + executable + ' not in whitelist');
      reply(replyMsg);
      return;
    }
    nmf = executable + '.nmf';
    self.checkUrlNaClManifestType(nmf, function(naclType) {
      reply({
        pid: self.spawn(nmf, args, envs, cwd, naclType, src)
      });
    }, function(msg) {
      var replyMsg = {
        pid: -Errno.ENOENT,
      };
      console.log('nacl_spawn(error): ' + msg);
      reply(replyMsg);
    });
  }
}


/**
 * Handle a waitpid call.
 * @private
 */
NaClProcessManager.prototype.handleMessageWait_ = function(msg, reply, src) {
  this.waitpid(msg['pid'], msg['options'], function(pid, status) {
    reply({
      pid: pid,
      status: status
    });
  }, src.pid);
}

/**
 * Handle a getpgid call.
 * @private
 */
NaClProcessManager.prototype.handleMessageGetPGID_ = function(msg, reply, src) {
  var pgid;
  var pid = parseInt(msg['pid']) || src.pid;

  if (pid < 0) {
    pgid = -Errno.EINVAL;
  } else if (!this.processes[pid] || this.processes[pid].exitCode !== null) {
    pgid = -Errno.ESRCH;
  } else {
    pgid = this.processes[pid].pgid;
  }
  reply({
    pgid: pgid,
  });
}

/**
 * Handle a setpgid call.
 * @private
 */
NaClProcessManager.prototype.handleMessageSetPGID_ = function(msg, reply, src) {
  var self = this;
  function setpgid() {
    var pid = parseInt(msg['pid']) || src.pid;
    var newPgid = parseInt(msg['pgid']) || pid;

    if (newPgid < 0) {
      return -Errno.EINVAL;
    }
    if (!self.processes[pid] || self.processes[pid].exitCode !== null ||
        (src.pid !== pid && src.pid !== self.processes[pid].ppid)) {
      return -Errno.ESRCH;
    }

    var oldPgid = self.processes[pid].pgid;
    var sid = self.processGroups[oldPgid].sid;

    // The new process group is in a different session.
    if (self.processGroups[newPgid] &&
        self.processGroups[newPgid].sid !== sid) {
      return -Errno.EPERM;
    }

    var callerPgid = self.processes[src.pid].pgid;
    var callerSid = self.processGroups[callerPgid].sid;

    // The process we are trying to change is in a different session from the
    // calling process.
    if (sid !== callerSid) {
      return -Errno.EPERM;
    }

    // The target process is a session leader.
    if (sid === pid) {
      return -Errno.EPERM;
    }

    self.deleteProcessFromGroup_(pid);
    if (self.processGroups[newPgid]) {
      self.processGroups[newPgid].processes[pid] = true;
    } else {
      self.createProcessGroup_(newPgid, sid);
    }
    self.processes[pid].pgid = newPgid;
    return 0;
  }
  reply({
    result: setpgid(),
  });
}

/**
 * Handle a getsid call.
 * @private
 */
NaClProcessManager.prototype.handleMessageGetSID_ = function(msg, reply, src) {
  var sid;
  var pid = parseInt(msg['pid']) || src.pid;
  var process = this.processes[pid];

  if (!process || process.exitCode !== null) {
    sid = -Errno.ESRCH;
  } else {
    sid = this.processGroups[process.pgid].sid;
  }
  reply({
    sid: sid
  });
}

/**
 * Handle a setsid call.
 * @private
 */
NaClProcessManager.prototype.handleMessageSetSID_ = function(msg, reply, src) {
  var pid = src.pid;
  var sid;

  // Setsid() cannot be called on a group leader.
  if (this.processGroups[pid]) {
    sid = -Errno.EPERM;
  } else {
    this.deleteProcessFromGroup_(pid);
    this.createProcessGroup_(pid, pid);
    sid = this.processes[pid].pgid = pid;
  }

  reply({
    sid: sid
  });
}

/**
 * Handle a pipe call.
 * @private
 */
NaClProcessManager.prototype.handleMessagePipe_ = function(msg, reply) {
  PipeServer.pipe().then(function(pipes) {
    reply({
      read: pipes[0],
      write: pipes[1]
    });
  }, function() {
    reply({
      read: -1,
      write: -1
    });
  });
}

/**
 * Handle progress event from NaCl.
 * @private
 */
NaClProcessManager.prototype.handleProgress_ = function(e) {
  if (this.isRootProcess(e.srcElement)) {
    this.onRootProgress(e.url, e.lengthComputable, e.loaded, e.total);
  }
}

/**
 * Handle load event from NaCl.
 * @private
 */
NaClProcessManager.prototype.handleLoad_ = function(e) {
  if (this.isRootProcess(e.srcElement)) {
    this.onRootLoad();
  }
}

/**
 * Handle abort event from NaCl.
 * @private
 */
NaClProcessManager.prototype.handleLoadAbort_ = function(e) {
  this.exit(NaClProcessManager.EXIT_CODE_KILL, e.srcElement);
}

/**
 * Handle load error event from NaCl.
 * @private
 */
NaClProcessManager.prototype.handleLoadError_ = function(e) {
  this.onError(e.srcElement.commandName, e.srcElement.lastError);
  this.exit(NaClProcessManager.EX_NO_EXEC, e.srcElement);
}

/**
 * Handle crash event from NaCl.
 * @private
 */
NaClProcessManager.prototype.handleCrash_ = function(e) {
  this.exit(e.srcElement.exitStatus, e.srcElement);
}

/**
 * Create a process group with the given process as the leader and add the
 * group to the table.
 * @private
 * @param {number} pid The process that will be the leader.
 * @param {number} sid The session ID of the session to which the process
 *     group belongs.
 */
NaClProcessManager.prototype.createProcessGroup_ = function(pid, sid) {
  if (this.processGroups[pid] !== undefined) {
    throw new Error('createProcessGroup_(): process group already exists');
  }
  this.processGroups[pid] = {
    sid: sid,
    processes: {}
  }
  this.processGroups[pid].processes[pid] = true;
}

/**
 * Delete a process from the process group table. If a group has no more
 * processes, delete the group as well.
 * @private
 * @param {number} pid The process to be deleted.
 */
NaClProcessManager.prototype.deleteProcessFromGroup_ = function(pid) {
  if (this.processes[pid] === undefined) {
    throw new Error('deleteProcessFromGroup_(): process does not exist');
  }
  var pgid = this.processes[pid].pgid;
  if (this.processGroups[pgid] === undefined ||
      this.processGroups[pgid].processes[pid] === undefined) {
    throw new Error('deleteProcessFromGroup_(): process group not found');
  }
  delete this.processGroups[pgid].processes[pid];
  if (Object.keys(this.processGroups[pgid].processes).length === 0) {
    delete this.processGroups[pgid];
  }
}

/**
 * Remove entries for a process from the process table.
 * @private
 */
NaClProcessManager.prototype.deleteProcessEntry_ = function(pid) {
  delete this.processes[pid];
}

/**
 * Exit the command.
 * @param {number} code The exit code of the process.
 * @param {HTMLObjectElement} element The HTML element of the exited process.
 */
NaClProcessManager.prototype.exit = function(code, element) {
  var pid = element.pid;
  var ppid = this.processes[pid].ppid;
  var pgid = this.processes[pid].pgid;

  this.deleteProcessFromGroup_(pid);

  // Reply to processes waiting on the exited process.
  var waitersToCheck = [pid, -1, -pgid];
  var reaped = false;
  for (var i = 0; i < waitersToCheck.length; i++) {
    var currPid = waitersToCheck[i];
    if (this.waiters[currPid] === undefined) {
      continue;
    }
    var currPidWaiters = this.waiters[currPid];
    for (var j = 0; j < currPidWaiters.length; j++) {
      var waiter = currPidWaiters[j];
      if (waiter.srcPid === ppid) {
        waiter.reply(pid, code);
        reaped = true;
      }
    }
    this.waiters[currPid] = currPidWaiters.filter(function(waiter) {
      return waiter.srcPid !== ppid;
    });
    if (this.waiters[currPid].length === 0) {
      delete this.waiters[currPid];
    }
  }
  if (reaped) {
    this.deleteProcessEntry_(pid);
  } else {
    this.processes[pid].exitCode = code;
  }

  // Mark as terminated.
  element.pid = -1;

  // Clean up HTML elements.
  if (element.parentNode === document.body) {
    document.body.removeChild(element);
  }

  if (element.popup) {
    element.popup.destroy();
  }

  var nextForegroundProcess = null;
  if (this.foregroundProcess === element) {
    nextForegroundProcess = element.parent;
    // When the parent has already finished, give the control to the
    // grand parent.
    while (nextForegroundProcess && nextForegroundProcess.pid === -1)
      nextForegroundProcess = nextForegroundProcess.parent;

    this.foregroundProcess = nextForegroundProcess;
  }
};

/**
 * Determines if an object is a nacl or pnacl manifest.
 *
 * @param {object} manifest A manifest to examine.
 * @return {string} 'nacl' or 'pnacl' on success, or null on failure..
 */
NaClProcessManager.prototype.checkNaClManifestType_ = function(manifest) {
  if ('program' in manifest) {
    if ('portable' in manifest.program &&
        'pnacl-translate' in manifest.program.portable) {
      return 'pnacl';
    } else {
      return 'nacl';
    }
  } else {
    return null;
  }
};

/**
 * Determines if an url points to a nacl or pnacl manifest.
 *
 * @param {string} url The url to download and parse.
 * @callback typeCallback Called with 'nacl' or 'pnacl' on success.
 * @callback errorCallback Called with error message on failure.
 */
NaClProcessManager.prototype.checkUrlNaClManifestType = function(
    url, typeCallback, errorCallback) {
  var self = this;
  var request = new XMLHttpRequest();
  request.open('GET', url, true);
  request.onload = function() {
    try {
      var manifest = JSON.parse(request.responseText);
    } catch(e) {
      errorCallback('NaCl Manifest is not valid JSON at ' + url);
      return;
    }
    var kind = self.checkNaClManifestType_(manifest);
    if (kind === null) {
      errorCallback('NaCl Manifest has bad format at ' + url);
    } else {
      typeCallback(kind);
    }
  };
  request.onerror = function() {
    errorCallback('NaCl Manifest is unreachable at ' + url);
  };
  request.send();
};

/**
 * This spawns a new NaCl process in the current window by creating an HTML
 * embed element.
 *
 * @param {string} nmf The path to the NaCl NMF file.
 * @param {Array.<string>} argv The command-line arguments to be given to the
 *     spawned process.
 * @param {Array.<string>} envs The environment variables that the spawned
 *     process can access. Each entry in the array should be of the format
 *     "VARIABLE_NAME=value".
 * @param {string} cwd The current working directory.
 * @param {string} naclType 'nacl' or 'pnacl' to select the mime-type.
 * @param {HTMLObjectElement} [parent=null] The DOM object that corresponds to
 *     the process that initiated the spawn. Set to null if there is no such
 *     process.
 * @returns {number} PID of the spawned process, or -1 if there was an error.
 */
NaClProcessManager.prototype.spawn = function(
    nmf, argv, envs, cwd, naclType, parent) {
  if (!parent) parent = null;

  var mimetype = 'application/x-' + naclType;
  if (navigator.mimeTypes[mimetype] === undefined) {
    if (mimetype.indexOf('pnacl') != -1)
      throw new Error('Browser does not support PNaCl or PNaCl is disabled\n');
    else
      throw new Error('Browser does not support NaCl or NaCl is disabled\n');
  }

  var fg = document.createElement('object');
  this.foregroundProcess = fg;

  fg.pid = this.pid;
  ++this.pid;

  fg.width = 0;
  fg.height = 0;
  fg.data = nmf;
  fg.type = mimetype;
  fg.parent = parent;
  fg.commandName = argv[0];

  fg.addEventListener('abort', this.handleLoadAbort_.bind(this));
  fg.addEventListener('crash', this.handleCrash_.bind(this));
  fg.addEventListener('error', this.handleLoadError_.bind(this));
  fg.addEventListener('load', this.handleLoad_.bind(this));
  fg.addEventListener('message', this.handleMessage_.bind(this));
  fg.addEventListener('progress', this.handleProgress_.bind(this));

  var pgid = parent ? this.processes[parent.pid].pgid : fg.pid;
  var ppid = parent ? parent.pid : NaClProcessManager.INIT_PID;
  this.processes[fg.pid] = {
    domElement: fg,
    exitCode: null,
    pgid: pgid,
    ppid: ppid
  };
  if (!parent) {
    this.createProcessGroup_(fg.pid, fg.pid);
  }
  this.processGroups[pgid].processes[fg.pid] = true;

  var params = {};

  envs.push('NACL_PID=' + fg.pid);
  envs.push('NACL_PPID=' + ppid);
  if (chrome && chrome.runtime && chrome.runtime.getPlatformInfo) {
    if (this.naclArch === null) {
      throw new Error('naclArch not yet set, race in startup\n');
    }
    envs.push('NACL_ARCH=' + this.naclArch);
  }

  for (var i = 0; i < envs.length; i++) {
    var env = envs[i];
    var index = env.indexOf('=');
    if (index < 0) {
      console.error('Broken env: ' + env);
      continue;
    }
    var key = env.substring(0, index);
    if (key === 'SRC' || key === 'DATA' || key.match(/^ARG\d+$/i))
      continue;
    params[key] = env.substring(index + 1);
  }

  params['PS_TTY_PREFIX'] = NaClProcessManager.prefix;
  params['PS_TTY_RESIZE'] = 'tty_resize';
  params['PS_TTY_COLS'] = this.ttyWidth;
  params['PS_TTY_ROWS'] = this.ttyHeight;
  params['PS_STDIN'] = '/dev/tty';
  params['PS_STDOUT'] = '/dev/tty';
  params['PS_STDERR'] = '/dev/tty';
  params['PS_VERBOSITY'] = '2';
  params['PS_EXIT_MESSAGE'] = 'exited';
  params['TERM'] = 'xterm-256color';
  params['PWD'] = cwd;
  // TODO(bradnelson): Drop this hack once tar extraction first checks relative
  // to the nexe.
  if (NaClProcessManager.useNaClAltHttp === true) {
    params['NACL_ALT_HTTP'] = '1';
  }

  function addParam(name, value) {
    // Don't set a 'type' field as this seems to confuse manifest parsing for
    // pnacl.
    if (name.toLowerCase() === 'type') {
      return;
    }
    var param = document.createElement('param');
    param.name = name;
    param.value = value;
    fg.appendChild(param);
  }

  for (var key in params) {
    addParam(key, params[key]);
  }

  // Add ARGV arguments from query parameters.
  function parseQuery(query) {
    if (query.charAt(0) === '?') {
      query = query.substring(1);
    }
    var splitArgs = query.split('&');
    var args = {};
    for (var i = 0; i < splitArgs.length; i++) {
      var keyValue = splitArgs[i].split('=');
      args[decodeURIComponent(keyValue[0])] = decodeURIComponent(keyValue[1]);
    }
    return args;
  }
  var args = parseQuery(document.location.search);
  for (var argname in args) {
    addParam(argname, args[argname]);
  }

  // If the application has set NaClTerm.argv and there were
  // no arguments set in the query parameters then add the default
  // NaClTerm.argv arguments.
  // TODO(bradnelson): Consider dropping this method of passing in parameters.
  if (args['arg1'] === undefined && argv) {
    var argn = 0;
    argv.forEach(function(arg) {
      var argname = 'arg' + argn;
      addParam(argname, arg);
      argn = argn + 1
    })
  }

  if (params[NaClProcessManager.ENV_SPAWN_MODE] ===
      NaClProcessManager.ENV_SPAWN_POPUP_VALUE) {
    var self = this;
    var popup = new GraphicalPopup(
      fg,
      parseInt(params[NaClProcessManager.ENV_POPUP_WIDTH] ||
               NaClProcessManager.POPUP_WIDTH_DEFAULT),
      parseInt(params[NaClProcessManager.ENV_POPUP_HEIGHT] ||
               NaClProcessManager.POPUP_HEIGHT_DEFAULT),
      argv[0]
    );
    popup.setClosedListener(function() {
      self.exit(NaClProcessManager.EXIT_CODE_KILL, popup.process);
      GraphicalPopup.focusCurrentWindow();
    });

    fg.popup = popup;

    popup.create();
  } else {
    if (params[NaClProcessManager.ENV_SPAWN_MODE] ===
               NaClProcessManager.ENV_SPAWN_EMBED_VALUE) {
      var style = fg.style;
      style.position = 'absolute';
      style.top = 0;
      style.left = 0;
      style.width = params[NaClProcessManager.ENV_EMBED_WIDTH] ||
        NaClProcessManager.EMBED_WIDTH_DEFAULT;
      style.height = params[NaClProcessManager.ENV_EMBED_HEIGHT] ||
        NaClProcessManager.EMBED_HEIGHT_DEFAULT;
    }
    document.body.appendChild(fg);
  }

  // Work around crbug.com/350445
  var junk = fg.offsetTop;

  return fg.pid;
}

/**
 * Handles the exiting of a process.
 * @callback waitCallback
 * @param {number} pid The PID of the process that exited or an error code on
 *     error.
 * @param {number} status The exit code of the process.
 */

/**
 * Waits for the process identified by pid to exit, and call a callback when
 * finished.
 * @param {number} pid The process ID of the process. If pid==-1, wait for any
 *     child. If pid==0, wait for any child in the caller's process group. If
 *     pid<-1, wait for any child in the process group with process group
 *     id==|pid|.
 * @param {number} options The desired options, ORed together.
 * @param {waitCallback} reply The callback to be called when the process has
 *     exited.
 * @param {number} [srcPid=1] The process PID of the calling process. Assume
 *     the init process if omitted.
 */
NaClProcessManager.prototype.waitpid = function(pid, options, reply, srcPid) {
  var self = this;
  if (srcPid === undefined) {
    srcPid = NaClProcessManager.INIT_PID;
  }

  // The specified process does not exist or is not a child.
  if (pid > 0 && (this.processes[pid] === undefined ||
                  this.processes[pid].ppid !== srcPid)) {
    reply(-Errno.ECHILD, 0);
    return;
  }

  // The specified process has already finished.
  if (pid > 0 && this.processes[pid].exitCode !== null) {
    var exitCode = this.processes[pid].exitCode;
    this.deleteProcessEntry_(pid);
    reply(pid, exitCode);
    return;
  }

  // There should be no processes in the init process group.
  if (pid === 0 && srcPid === NaClProcessManager.INIT_PID) {
    reply(-Errno.ECHILD, 0);
    return;
  }

  // pid = 0 waits for processes in the calling process's group.
  if (pid === 0) {
    pid = -this.processes[srcPid].pgid;
  }

  if (pid < 0) {
    var finishedPid = null;
    for (var processPid in this.processes) {
      var process = this.processes[processPid];
      if (process.exitCode !== null &&
          process.ppid === srcPid &&
          (pid === -1 || process.pgid === -pid)) {
        finishedPid = parseInt(processPid);
        break;
      }
    }

    if (finishedPid !== null) {
      reply(finishedPid, this.processes[finishedPid].exitCode);
      this.deleteProcessEntry_(finishedPid);
      return;
    }
  }

  if ((options & NaClProcessManager.WNOHANG) != 0) {
    reply(0, 0);
    return;
  }

  // Add the waitpid call to the waiter list.
  if (!this.waiters[pid]) {
    this.waiters[pid] = [];
  }
  this.waiters[pid].push({
    reply: reply,
    options: options,
    srcPid: srcPid
  });
}

/**
 * Update the dimensions of the terminal on terminal resize.
 * @param {number} width The width of the terminal.
 * @param {number} height The height of the terminal.
 */
NaClProcessManager.prototype.onTerminalResize = function(width, height) {
  this.ttyWidth = width;
  this.ttyHeight = height;
  if (this.foregroundProcess) {
    this.foregroundProcess.postMessage({'tty_resize': [ width, height ]});
  }
}

/**
 * Handle a SIGINT signal.
 * @returns {boolean} Whether or not the interrupt succeeded.
 */
NaClProcessManager.prototype.sigint = function() {
  if (!this.foregroundProcess)
    throw new Error(NaClProcessManager.NO_FG_ERROR);

  // TODO(bradnelson): Change this once we support signals.
  // Abort on Control+C, but don't quit bash.
  if (!this.isRootProcess(this.foregroundProcess)) {
    // Only exit if the appropriate environment variable is set.
    var query = 'param[name="' + NaClProcessManager.ENV_ABORT + '"]';
    var enabledEnv = this.foregroundProcess.querySelector(query);
    if (enabledEnv && enabledEnv.value === NaClProcessManager.ENV_ABORT_VALUE) {
      this.exit(NaClProcessManager.EXIT_CODE_KILL, this.foregroundProcess);
      return true;
    }
  }
  return false;
};

/**
 * Send standard input to the foreground process.
 * @param {string} str The string to be sent to as stdin.
 */
NaClProcessManager.prototype.sendStdinForeground = function(str) {
  if (!this.foregroundProcess)
    throw new Error(NaClProcessManager.NO_FG_ERROR);

  var message = {};
  message[NaClProcessManager.prefix] = str;
  this.foregroundProcess.postMessage(message);
};

/**
 * This creates a popup that runs a NaCl process inside.
 *
 * @param {Object} process The NaCl process to be run.
 * @param {number} width
 * @param {number} height
 * @param {string} title
 */
function GraphicalPopup(process, width, height, title) {
  this.process = process || null;
  this.width = width || GraphicalPopup.DEFAULT_WIDTH;
  this.height = height || GraphicalPopup.DEFAULT_HEIGHT;
  this.title = title || '';
  this.win = null;
  this.onClosed = function () {};
}

/**
 * The default width of the popup.
 * @type {number}
 */
GraphicalPopup.DEFAULT_WIDTH = 600;

/**
 * The default height of the popup.
 * @type {number}
 */
GraphicalPopup.DEFAULT_HEIGHT = 400;

/**
 * The (empty) HTML file to which the NaCl module is added.
 * @const
 */
GraphicalPopup.HTML_FILE = 'graphical.html';

/**
 * Focus the window in which this code is run.
 */
GraphicalPopup.focusCurrentWindow = function() {
  chrome.app.window.current().focus();
}

/**
 * This callback is called when the popup is closed.
 * @callback closedCallback
 */

/**
 * Set a function to be called as a callback when the popup is closed.
 * @param {closedCallback} listener
 */
GraphicalPopup.prototype.setClosedListener = function(listener) {
  if (this.win) {
    throw new Error("Cannot set closed listener after creating window.");
  }
  this.onClosed = listener;
}

/**
 * Create the window.
 */
GraphicalPopup.prototype.create = function() {
  var self =  this;
  chrome.app.window.create('graphical.html', {
    'bounds': {
      'width': self.width,
      'height': self.height
    },
  }, function(win) {
    var process = self.process;
    var popup = win.contentWindow;

    self.win = process.window = win;

    popup.document.title = self.title;

    popup.addEventListener('load', function() {
      process.style.position = 'absolute';
      process.style.top = '0';
      process.style.left = '0';
      process.style.width = '100%';
      process.style.height = '100%';
      popup.document.body.appendChild(process);
    });

    popup.focused = true;
    popup.addEventListener('focus', function() {
      this.focused = true;
    });
    popup.addEventListener('blur', function() {
      this.focused = false;
    });

    win.onClosed.addListener(self.onClosed);
  });
}

/**
 * Close the popup.
 */
GraphicalPopup.prototype.destroy = function() {
  if (this.win.contentWindow.focused) {
    GraphicalPopup.focusCurrentWindow();
  }
  this.win.onClosed.removeListener(this.onClosed);
  this.win.close();

  this.process = null;
  this.win = null;
}
