//根据一个面发射面内的某个随机点坐标，主要用于粒子发射
class Emitter {
    constructor() {
        this._positions = null;
        this.boundingSphere = null;
        this._geometry = null;
        this._triangleArrayByWeight = null;
    }
    initPolygonEmitter(positions) {
        this._positions = SuperMap3D.defaultValue(positions, [new SuperMap3D.Cartesian3(), new SuperMap3D.Cartesian3(), new SuperMap3D.Cartesian3()]);
        this.boundingSphere = SuperMap3D.BoundingSphere.fromPoints(positions);
        if (SuperMap3D.defaultValue(positions)) {
            let PolygonGeometry = SuperMap3D.PolygonGeometry.fromPositions({
                positions: positions,
                perPositionHeight: true
            });
            this._geometry = SuperMap3D.PolygonGeometry.createGeometry(PolygonGeometry);
            this._triangleArrayByWeight = this.initWeight(this._geometry);
        }
    }

    get positions() {
        return this._positions;
    };
    set positions(positions) {
        if (!SuperMap3D.defaultValue(positions)) {
            return;
        }
        this._positions = positions;
        let PolygonGeometry = SuperMap3D.PolygonGeometry.fromPositions({
            positions: this._positions,
            perPositionHeight: true
        });
        this._geometry = SuperMap3D.PolygonGeometry.createGeometry(PolygonGeometry);
        this._triangleArrayByWeight = this.initWeight(this._geometry);
        this.boundingSphere = SuperMap3D.BoundingSphere.fromPoints(positions);
    }


    initWeight(geometry) {
        let vertex0 = new SuperMap3D.Cartesian3();
        let vertex1 = new SuperMap3D.Cartesian3();
        let vertex2 = new SuperMap3D.Cartesian3();
        let indices = geometry.indices;
        let triangleCount = indices.length / 3;
        let vertices = geometry.attributes.position.values;
        let i, j;
        let areaArray = [];
        let totalArea = 0.0;
        for (i = 0; i < triangleCount; i++) {
            let vertexIndex0 = indices[i * 3];
            let vertexIndex1 = indices[i * 3 + 1];
            let vertexIndex2 = indices[i * 3 + 2];
            vertex0.x = vertices[vertexIndex0 * 3];
            vertex0.y = vertices[vertexIndex0 * 3 + 1];
            vertex0.z = vertices[vertexIndex0 * 3 + 2];

            vertex1.x = vertices[vertexIndex1 * 3];
            vertex1.y = vertices[vertexIndex1 * 3 + 1];
            vertex1.z = vertices[vertexIndex1 * 3 + 2];

            vertex2.x = vertices[vertexIndex2 * 3];
            vertex2.y = vertices[vertexIndex2 * 3 + 1];
            vertex2.z = vertices[vertexIndex2 * 3 + 2];
            let area = this.triangleArea(vertex0, vertex1, vertex2);
            totalArea += area;
            areaArray.push(area);
        }

        let weightArraySize = Math.max(100, triangleCount * 10);
        let triangleWeightArray = [];
        for (i = 0; i < triangleCount; i++) {
            let weight = Math.floor(areaArray[i] / totalArea * weightArraySize);
            weight = Math.max(1, weight);
            for (j = 0; j < weight; j++) {
                triangleWeightArray.push(i);
            }
        }
        return triangleWeightArray;
    }

    triangleArea(v0, v1, v2) {
        let scratchCartesian0 = new SuperMap3D.Cartesian3();
        let scratchCartesian1 = new SuperMap3D.Cartesian3();
        let scratchCartesian2 = new SuperMap3D.Cartesian3();
        scratchCartesian0 = SuperMap3D.Cartesian3.subtract(v1, v0, scratchCartesian0);
        scratchCartesian1 = SuperMap3D.Cartesian3.subtract(v2, v0, scratchCartesian1);
        scratchCartesian2 = SuperMap3D.Cartesian3.cross(scratchCartesian0, scratchCartesian1, scratchCartesian2);
        return 0.5 * SuperMap3D.Cartesian3.magnitude(scratchCartesian2);
    }

    randomVertex(r1, r2, A, B, C) {
        return (1 - Math.sqrt(r1)) * A + Math.sqrt(r1) * (1 - r2) * B + Math.sqrt(r1) * r2 * C;
    }

    getOneRandomPosition() {
        if (!SuperMap3D.defaultValue(this._geometry)) {
            return;
        }
        let indexInWeightArray = Math.floor(SuperMap3D.Math.randomBetween(0.0, this._triangleArrayByWeight.length));
        let triangleIndex = this._triangleArrayByWeight[indexInWeightArray];
        let vertexIndex0 = this._geometry.indices[triangleIndex * 3];
        let vertexIndex1 = this._geometry.indices[triangleIndex * 3 + 1];
        let vertexIndex2 = this._geometry.indices[triangleIndex * 3 + 2];
        let vertices = this._geometry.attributes.position.values;
        let vertex0X = vertices[vertexIndex0 * 3];
        let vertex0Y = vertices[vertexIndex0 * 3 + 1];
        let vertex0Z = vertices[vertexIndex0 * 3 + 2];

        let vertex1X = vertices[vertexIndex1 * 3];
        let vertex1Y = vertices[vertexIndex1 * 3 + 1];
        let vertex1Z = vertices[vertexIndex1 * 3 + 2];

        let vertex2X = vertices[vertexIndex2 * 3];
        let vertex2Y = vertices[vertexIndex2 * 3 + 1];
        let vertex2Z = vertices[vertexIndex2 * 3 + 2];

        let r1 = SuperMap3D.Math.randomBetween(0.0, 1.0);
        let r2 = SuperMap3D.Math.randomBetween(0.0, 1.0);
        let x = this.randomVertex(r1, r2, vertex0X, vertex1X, vertex2X);
        let y = this.randomVertex(r1, r2, vertex0Y, vertex1Y, vertex2Y);
        let z = this.randomVertex(r1, r2, vertex0Z, vertex1Z, vertex2Z);

        return SuperMap3D.Cartesian3.fromElements(x, y, z);
    };
}

export default Emitter;