# Copyright (c) 2012 The Native Client Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

BUILD_DIR=${SRC_DIR}

ConfigureStep() {
  if [ "${NACL_LIBC}" != "newlib" ]; then
    return
  fi
  LogExecute cp -rf ${START_DIR}/* .
  LogExecute rm -rf out
}

BuildStep() {
  if [ "${NACL_LIBC}" != "newlib" ]; then
    return
  fi
  # export the nacl tools
  export CC=${NACLCC}
  export CXX=${NACLCXX}
  export AR=${NACLAR}
  export NACL_SDK_VERSION
  export NACL_SDK_ROOT
  DefaultBuildStep
}

InstallStep() {
  if [ "${NACL_LIBC}" != "newlib" ]; then
    return
  fi
  local LIB=libglibc-compat.a
  INCDIR=${DESTDIR_INCLUDE}/glibc-compat
  MakeDir ${DESTDIR_LIB}
  Remove ${INCDIR}
  MakeDir ${INCDIR}
  LogExecute install -m 644 out/${LIB} ${DESTDIR_LIB}/${LIB}
  for file in include/*.h ${INCDIR}; do
    if [ -f $file ]; then
      LogExecute install -m 644 $file ${INCDIR}/
    fi
  done
  for dir in sys arpa machine net netinet netinet6; do
    MakeDir ${INCDIR}/${dir}
    LogExecute install -m 644 include/${dir}/*.h ${INCDIR}/${dir}/
  done
}
