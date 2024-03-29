# Copyright (c) 2014 The Native Client Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

EXECUTABLES=make${NACL_EXEEXT}

NACLPORTS_CPPFLAGS+=" -Dmain=nacl_main"
export LIBS+="${NACL_CLI_MAIN_LIB} \
-lnacl_spawn -lppapi_simple -lnacl_io -lppapi -lppapi_cpp -l${NACL_CPP_LIB}"

if [ "${NACL_LIBC}" = "newlib" ]; then
  NACLPORTS_CPPFLAGS+=" -D_POSIX_VERSION"
fi

InstallStep() {
  PublishByArchForDevEnv
}
