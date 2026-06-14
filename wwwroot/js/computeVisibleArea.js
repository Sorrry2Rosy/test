function computePoint(far, fovX, fovY) {
    let x = far * Math.cos(fovY) * Math.sin(fovX);
    let y = far * Math.sin(fovY);
    let z = far * Math.cos(fovY) * Math.cos(fovX);
    return new SuperMap3D.Cartesian3(x, y, z);
}

/**
 * 求射线与球的交点
 * @param camera 相机
 * @param ray 射线
 * @param ellipsoid 参考球
 * @returns {Cartesian3}
 */
function intersectMainifoldClosestSilhouette(camera, ray, ellipsoid) {
    let res = SuperMap3D.IntersectionTests.rayEllipsoid(ray, ellipsoid);
    if(SuperMap3D.defined(res)){
        // return SuperMap3D.Ray.getPoint(ray, res.start, new SuperMap3D.Cartesian3());
        let interPoint = SuperMap3D.Ray.getPoint(ray, res.start, new SuperMap3D.Cartesian3());
        if(!SuperMap3D.Cartesian3.equalsEpsilon(camera.positionWC, interPoint, SuperMap3D.Math.EPSILON10)){
            return interPoint; // 只有射线与球交点和视锥体视点不一致时才返回
        }
    }

    let radius = ellipsoid.radii.x;
    let ka = SuperMap3D.Cartesian3.cross(ray.origin, ray.direction, new SuperMap3D.Cartesian3());
    let ea = SuperMap3D.Cartesian3.cross(ka, ray.origin, new SuperMap3D.Cartesian3());
    let len = SuperMap3D.Cartesian3.distance(ea, SuperMap3D.Cartesian3.ZERO);
    SuperMap3D.Cartesian3.multiplyByScalar(ea, 1 / len * radius, ea);
    let dis = SuperMap3D.Cartesian3.distance(ray.origin, SuperMap3D.Cartesian3.ZERO);
    let cosAngle = Math.acos(radius / (radius + Math.abs(radius - dis)));
    let angle = SuperMap3D.Cartesian3.angleBetween(ea, ray.origin) * -1;
    angle = angle + cosAngle;
    let rotationMat3 = new SuperMap3D.Matrix3();
    let q = SuperMap3D.Quaternion.fromAxisAngle(ka, angle);
    SuperMap3D.Matrix3.fromQuaternion(q, rotationMat3);
    let mat4 = new SuperMap3D.Matrix4();
    SuperMap3D.Matrix4.fromRotationTranslation(rotationMat3, new SuperMap3D.Cartesian3(), mat4);
    let vector = SuperMap3D.Matrix4.multiplyByPoint(mat4, ea, new SuperMap3D.Cartesian3());
    let scale = SuperMap3D.Cartesian3.distance(ray.origin, vector);
    let scaleVec = SuperMap3D.Cartesian3.multiplyByScalar(ray.direction, scale, new SuperMap3D.Cartesian3());
    let point = SuperMap3D.Cartesian3.add(ray.origin, scaleVec, new SuperMap3D.Cartesian3());
    let cullingVolume = camera.frustum.computeCullingVolume(camera.positionWC, camera.directionWC, camera.upWC, 0);
    let farPlane = SuperMap3D.Plane.fromCartesian4(cullingVolume.planes.at(-1));
    let result = SuperMap3D.IntersectionTests.lineSegmentPlane(ray.origin, point, farPlane);
    if(!SuperMap3D.defined(result)){
        return point;
    }

    return result;
}

/**
 * 估算相机射线与球的交点的高度
 * @param camera
 * @returns {number|Number|*|number}
 */
function estimatedSurfaceAltitude(camera) {
    const scene = camera._scene;
    const windowPosition = new SuperMap3D.Cartesian2();
    windowPosition.x = scene.drawingBufferWidth / 2.0;
    windowPosition.y = scene.drawingBufferHeight / 2.0;
    const ray = camera.getPickRay(windowPosition, new SuperMap3D.Ray());
    const result = scene.globe.pickWorldCoordinates(ray, scene);
    if(SuperMap3D.defined(result)){
        return SuperMap3D.Cartographic.fromCartesian(result).height;
    }

    return 0;
}

/**
 * 计算相机视域的投影范围
 * @returns {Cartesian3 []} 投影范围的二维点集合
 */
function computeVisibleArea(camera) {
    const frustum = camera.frustum;
    const scene = camera._scene;
    const projection = scene.mapProjection;
    const far = frustum.far;
    const fov = frustum.fov;
    const fovy = frustum.fovy;
    const tanThetaY = Math.tan(fovy * 0.5);
    const top = far * tanThetaY;
    const startFovX = Math.PI - fov * 0.5;
    const tanY = top / (far / Math.cos(startFovX));
    const newHalfFovY = Math.atan(tanY);
    const leftTopPoint = computePoint(far, startFovX, -newHalfFovY);
    const leftBottomPoint = computePoint(far, startFovX, newHalfFovY);
    const rightTopPoint = computePoint(far, startFovX + fov, -newHalfFovY);
    const rightBottomPoint = computePoint(far, startFovX + fov, newHalfFovY);
    const pts = [leftBottomPoint, rightBottomPoint, rightTopPoint, leftTopPoint];
    const points = [];
    const ray = new SuperMap3D.Ray();
    ray.origin = camera.positionWC;
    let height = estimatedSurfaceAltitude(camera);
    const radiusX = SuperMap3D.Ellipsoid.WGS84.radii.x + height;
    const radiusY = SuperMap3D.Ellipsoid.WGS84.radii.y + height;
    const radiusZ = SuperMap3D.Ellipsoid.WGS84.radii.z + height;
    const ellipsoid = new SuperMap3D.Ellipsoid(radiusX, radiusY, radiusZ);
    for(let i = 0;i < 4;i++){
        let p = pts[i];
        SuperMap3D.Matrix4.multiplyByPoint(camera._invViewMatrix, p, p);
        SuperMap3D.Cartesian3.subtract(p, ray.origin, ray.direction);
        SuperMap3D.Cartesian3.normalize(ray.direction, ray.direction);
        let point = intersectMainifoldClosestSilhouette(camera, ray, ellipsoid);
        points.push(point);
    }

    return points;
}